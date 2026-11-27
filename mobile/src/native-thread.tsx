import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { LocalMessage } from "../../frontend/lib/crypto/types";
import { b64ToBytes } from "../../frontend/lib/crypto/bytes";
import { openGroupRecord, sealGroupRecord } from "../../frontend/lib/crypto/group-store";
import { queueGroupMessage, syncGroup, type GroupWireBlob } from "../../frontend/lib/group-runtime";
import {
  archiveGroupMessages,
  acknowledgeArchiveRecoveryCode,
  bootstrapDevice,
  conversationPlaintext,
  currentDeviceId,
  currentSigningMaterial,
  currentUserId,
  currentVaultKey,
  encryptOutgoing,
  ingestWireMessages,
  isUnlocked,
  lockDevice,
  storeSentMessage,
  syncConversationMessageDeletions,
  syncConversationRecoveryHistory,
} from "../../frontend/lib/session";
import {
  deletePendingDirectSend,
  listPendingDirectSends,
  loadSealedGroup,
  loadWireCursor,
  saveLocalMessage,
  savePendingDirectSend,
  saveSealedGroup,
  saveWireCursor,
  type PendingDirectSend,
} from "../../frontend/lib/idb";
import { api, setApiCookie, type Conversation } from "./api";
import { NativeMediaComposer } from "./media-composer";
import { NativeMessageBody } from "./message-body";
import { ActionButton, C, Input, Notice } from "./ui";

type Props = { conversation: Conversation; cookie: string };

type GroupStatus = {
  joined: boolean;
  error: string | null;
};

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : "Could not sync this conversation. Try again.";
}

function runtimeDiagnostic(error: unknown) {
  const detail = friendlyError(error);
  if (!detail.toLowerCase().includes("undefined is not a function")) return "";
  return error instanceof Error ? error.stack ?? `${error.name}: ${detail}` : detail;
}

async function loadGroupBlobs(conversationId: string, deviceId: string, after?: string) {
  const blobs: GroupWireBlob[] = [];
  let cursor = after;
  for (let page = 0; page < 20; page += 1) {
    const result = await api.groupMls(conversationId, deviceId, cursor);
    blobs.push(...result.blobs);
    if (result.blobs.length < 100) break;
    const next = result.blobs[result.blobs.length - 1]?.id;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return blobs;
}

function mergeMessages(current: LocalMessage[], next: LocalMessage[]) {
  const merged = new Map(current.map((message) => [message.id, message]));
  for (const message of next) merged.set(message.id, message);
  return [...merged.values()].sort((left, right) =>
    left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt),
  );
}

export function NativeThread({ conversation, cookie }: Props) {
  const [unlocked, setUnlocked] = useState(isUnlocked());
  const [vaultPassword, setVaultPassword] = useState("");
  const [historyRecoveryInput, setHistoryRecoveryInput] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockStep, setUnlockStep] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockDiagnostic, setUnlockDiagnostic] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [pendingSends, setPendingSends] = useState<PendingDirectSend[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendQueued, setSendQueued] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [groupStatus, setGroupStatus] = useState<GroupStatus | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(false);
  const listRef = useRef<FlatList<LocalMessage>>(null);
  const autoScroll = useRef(true);
  const refreshInFlight = useRef(false);
  const groupHistorySynced = useRef(new Set<string>());

  useEffect(() => { setApiCookie(cookie); }, [cookie]);
  useEffect(() => { setUnlocked(isUnlocked()); }, [conversation.id]);

  const myUserId = currentUserId();
  const displayMessages = useMemo(() => {
    const pending = pendingSends.map((send): LocalMessage => ({
      id: send.id,
      logicalMessageId: send.id,
      conversationId: send.conversationId,
      senderDeviceId: send.payload.senderDeviceId,
      senderUserId: myUserId ?? undefined,
      fromMe: true,
      plaintext: send.plaintext,
      createdAt: send.createdAt,
    }));
    return mergeMessages(messages, pending);
  }, [messages, myUserId, pendingSends]);

  const refreshLocal = useCallback(async () => {
    const [recent, pending] = await Promise.all([
      conversationPlaintext(conversation.id, 100),
      listPendingDirectSends(conversation.id),
    ]);
    setMessages(recent);
    setPendingSends(pending);
    setHasEarlier(recent.length >= 100);
  }, [conversation.id]);

  const syncGroupConversation = useCallback(async () => {
    const userId = currentUserId();
    const deviceId = currentDeviceId();
    const signing = currentSigningMaterial();
    const vaultKey = currentVaultKey();
    if (!userId || !signing || !vaultKey) throw new Error("Unlock this device to use group chat.");

    const [devices, sealed] = await Promise.all([
      api.groupDevices(conversation.id),
      loadSealedGroup(userId, conversation.id),
    ]);
    const existing = sealed ? await openGroupRecord(vaultKey, userId, conversation.id, sealed) : null;
    const after = existing
      ? existing.appliedBlobIds[existing.appliedBlobIds.length - 1]
      : undefined;
    const blobs = await loadGroupBlobs(conversation.id, deviceId, after);
    const member = conversation.members?.find((item) => item.userId === userId);
    const directory = devices.devices.map((device) => ({
      userId: device.userId,
      deviceId: device.deviceId,
      signingPublicKey: b64ToBytes(device.signingPublicKey),
      role: device.role,
    }));
    const role = member?.role === "ADMIN" || (!member && directory.some((device) => device.userId === userId && device.role === "admin"))
      ? "admin"
      : "member";

    const result = await syncGroup({
      record: existing,
      userId,
      deviceId,
      role,
      conversationId: conversation.id,
      signingPrivateJwk: signing.privateJwk,
      signingPublicKey: signing.publicKey,
      memberUserIds: conversation.memberUserIds ?? conversation.members?.map((item) => item.userId) ?? [userId],
      directory,
      blobs,
      post: (body) => api.postGroupMls(conversation.id, { ...body, senderDeviceId: deviceId }),
    });

    await saveSealedGroup(userId, conversation.id, await sealGroupRecord(vaultKey, userId, conversation.id, result.record));
    const newlyDecrypted: LocalMessage[] = result.messages.map((message) => {
      const sender = devices.devices.find((device) => device.deviceId === message.senderDeviceId);
      return {
        id: message.id,
        conversationId: conversation.id,
        senderDeviceId: message.senderDeviceId,
        senderUserId: sender?.userId,
        fromMe: message.senderDeviceId === deviceId,
        plaintext: message.plaintext,
        createdAt: message.createdAt,
      };
    });
    for (const message of newlyDecrypted) await saveLocalMessage(message);
    if (newlyDecrypted.length) await archiveGroupMessages(newlyDecrypted);

    const latestBlob = blobs[blobs.length - 1]?.id;
    const joined = Boolean(result.record.session) && !result.selfRemoved;
    setGroupStatus({ joined, error: result.error });
    if (joined && latestBlob) await api.markGroupRead(conversation.id, latestBlob).catch(() => undefined);
    if (joined && !groupHistorySynced.current.has(conversation.id)) {
      try {
        await syncConversationRecoveryHistory();
        groupHistorySynced.current.add(conversation.id);
        await refreshLocal();
      } catch (error) {
        setHistoryError(friendlyError(error));
      }
    }
  }, [conversation, refreshLocal]);

  const refreshConversation = useCallback(async () => {
    if (refreshInFlight.current || !isUnlocked()) return;
    refreshInFlight.current = true;
    try {
      if (conversation.type === "GROUP") {
        await syncGroupConversation();
      } else {
        await syncConversationMessageDeletions(conversation.id);
        let after = await loadWireCursor(conversation.id);
        for (let page = 0; page < 20; page += 1) {
          const { messages: wireMessages } = await api.messages(
            conversation.id,
            currentDeviceId(),
            undefined,
            !after,
            after,
            100,
          );
          if (!wireMessages.length) break;
          await ingestWireMessages(wireMessages);
          after = wireMessages[wireMessages.length - 1]?.id;
          if (after) await saveWireCursor(conversation.id, after);
          if (wireMessages.length < 100) break;
        }
      }
      await refreshLocal();
      setSyncError("");
    } catch (error) {
      setSyncError(friendlyError(error));
      const diagnostic = runtimeDiagnostic(error);
      if (diagnostic) setUnlockDiagnostic(diagnostic);
    } finally {
      refreshInFlight.current = false;
    }
  }, [conversation.id, conversation.type, refreshLocal, syncGroupConversation]);

  const unlock = useCallback(async () => {
    const password = vaultPassword;
    if (!password) return;
    let activeStep = "checking your account";
    const updateStep = (step: string) => {
      activeStep = step;
      setUnlockStep(step);
    };
    setUnlocking(true);
    setUnlockError("");
    setUnlockDiagnostic("");
    setHistoryError("");
    try {
      const setup = await bootstrapDevice(
        password,
        historyRecoveryInput.trim() || undefined,
        undefined,
        updateStep,
      );
      if (setup.archiveRecoveryCode) setRecoveryCode(setup.archiveRecoveryCode);
      setVaultPassword("");
      setHistoryRecoveryInput("");
      setUnlocked(true);
      updateStep("loading local messages");
      await refreshLocal();
      setHistoryBusy(true);
      try {
        updateStep("restoring previous encrypted messages");
        await syncConversationRecoveryHistory();
      } catch (error) {
        setHistoryError(`Could not finish ${activeStep}: ${friendlyError(error)}`);
        setUnlockDiagnostic(runtimeDiagnostic(error));
      } finally {
        setHistoryBusy(false);
      }
      updateStep("syncing this conversation");
      await refreshConversation();
    } catch (error) {
      const detail = friendlyError(error);
      console.warn("[sophia-mobile] vault unlock failed", {
        stage: activeStep,
        name: error instanceof Error ? error.name : "UnknownError",
        message: detail,
        stack: error instanceof Error ? error.stack : undefined,
      });
      setUnlockError(`Could not finish ${activeStep}: ${detail}`);
      setUnlockDiagnostic(runtimeDiagnostic(error));
    } finally {
      setUnlockStep("");
      setUnlocking(false);
    }
  }, [historyRecoveryInput, refreshConversation, refreshLocal, vaultPassword]);

  const sendPending = useCallback(async (send: PendingDirectSend) => {
    try {
      const result = await api.sendMessage(send.conversationId, send.payload);
      await storeSentMessage({
        id: result.logicalMessageId,
        conversationId: send.conversationId,
        plaintext: send.plaintext,
        createdAt: result.createdAt,
      });
      await deletePendingDirectSend(send.id);
      setPendingSends((current) => current.filter((item) => item.id !== send.id));
      setSendError("");
      setSendQueued(false);
      return true;
    } catch (error) {
      setSendError(friendlyError(error));
      setSendQueued(true);
      return false;
    }
  }, []);

  const flushPending = useCallback(async () => {
    if (conversation.type !== "DIRECT" || !isUnlocked()) return;
    const pending = await listPendingDirectSends(conversation.id);
    setPendingSends(pending);
    for (const item of pending) {
      if (!await sendPending(item)) break;
    }
  }, [conversation.id, conversation.type, sendPending]);

  useEffect(() => {
    if (!unlocked || !isUnlocked()) return;
    let active = true;
    const run = async () => {
      if (!active) return;
      await flushPending();
      await refreshConversation();
    };
    void refreshLocal();
    void run();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void run();
    }, 5000);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
      else {
        setUnlocked(false);
        setMessages([]);
        setPendingSends([]);
        void lockDevice();
      }
    });
    return () => {
      active = false;
      clearInterval(timer);
      appState.remove();
    };
  }, [flushPending, refreshConversation, refreshLocal, unlocked]);

  async function sendPlaintext(plaintext: string) {
    const text = plaintext.trim();
    if (!text || sending || !unlocked) return;
    setSending(true);
    setSendError("");
    setSendQueued(false);
    Keyboard.dismiss();
    try {
      if (conversation.type === "DIRECT") {
        const payload = await encryptOutgoing(conversation.id, text);
        const queued: PendingDirectSend = {
          id: payload.logicalMessageId,
          conversationId: conversation.id,
          plaintext: text,
          createdAt: new Date().toISOString(),
          payload,
        };
        await savePendingDirectSend(queued);
        setPendingSends((current) => [...current.filter((item) => item.id !== queued.id), queued]);
        await sendPending(queued);
        await refreshLocal();
      } else {
        const userId = currentUserId();
        const vaultKey = currentVaultKey();
        if (!userId || !vaultKey) throw new Error("Unlock this device to send group messages.");
        const sealed = await loadSealedGroup(userId, conversation.id);
        if (!sealed) throw new Error("This device is waiting for an existing group member to add it.");
        const record = await openGroupRecord(vaultKey, userId, conversation.id, sealed);
        if (!record.session) throw new Error("This device is waiting for an existing group member to add it.");
        const queued = await queueGroupMessage(record, text);
        await saveSealedGroup(userId, conversation.id, await sealGroupRecord(vaultKey, userId, conversation.id, queued));
        await refreshConversation();
      }
      autoScroll.current = true;
      listRef.current?.scrollToEnd({ animated: true });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) {
      setSendError(friendlyError(error));
      setSendQueued(false);
      throw error;
    } finally {
      setSending(false);
    }
  }

  async function loadEarlier() {
    const oldest = messages[0];
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    autoScroll.current = false;
    try {
      let older = await conversationPlaintext(conversation.id, 50, oldest);
      if (older.length < 50 && conversation.type === "DIRECT") {
        const { messages: wire } = await api.messages(conversation.id, currentDeviceId(), oldest, false, undefined, 50);
        await ingestWireMessages(wire);
        older = await conversationPlaintext(conversation.id, 50, oldest);
        setHasEarlier(wire.length >= 50 || older.length >= 50);
      } else {
        setHasEarlier(older.length >= 50);
      }
      setMessages((current) => mergeMessages(older, current));
      if (!older.length) setHasEarlier(false);
    } catch (error) {
      setSyncError(friendlyError(error));
    } finally {
      setLoadingEarlier(false);
    }
  }

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    autoScroll.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
  }

  if (!unlocked) {
    return <View style={styles.unlockRoot}>
      <View style={styles.unlockIcon}><Ionicons name="lock-closed" size={23} color={C.green} /></View>
      <Text style={styles.unlockTitle}>Unlock your encrypted chats</Text>
      <Text style={styles.unlockCopy}>Enter your Sophia messaging vault password. This device will join your secure account and restore the history available to you.</Text>
      <Input
        label="MESSAGING VAULT PASSWORD"
        value={vaultPassword}
        onChangeText={setVaultPassword}
        placeholder="Enter your vault password"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => void unlock()}
        editable={!unlocking}
      />
      <Input
        label="HISTORY RECOVERY CODE (OPTIONAL)"
        value={historyRecoveryInput}
        onChangeText={setHistoryRecoveryInput}
        placeholder="Needed after a password reset"
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!unlocking}
      />
      {!!unlockError && <Notice text={unlockError} />}
      {!!unlockDiagnostic && <Text selectable style={styles.unlockDiagnostic}>{unlockDiagnostic}</Text>}
      {unlocking && !!unlockStep && <Text accessibilityLiveRegion="polite" style={styles.unlockFoot}>{unlockStep}…</Text>}
      <ActionButton title="Unlock secure messages" icon="lock-open-outline" onPress={() => void unlock()} busy={unlocking} disabled={!vaultPassword} />
      <Text style={styles.unlockFoot}>Message keys and chat history are encrypted on this device. Sophia's servers only receive encrypted content.</Text>
    </View>;
  }

  return <View style={styles.root}>
    {!!recoveryCode && <View style={styles.recoveryCard}>
      <View style={styles.recoveryTitleRow}><Ionicons name="key-outline" size={17} color={C.amber} /><Text style={styles.recoveryTitle}>Save your history recovery code</Text></View>
      <Text style={styles.recoveryCopy}>Keep this code somewhere private. It can restore your encrypted chat history if you forget your messaging vault password. Press and hold the code to copy it.</Text>
      <Text selectable style={styles.recoveryCode}>{recoveryCode}</Text>
      <ActionButton title="I've saved it" icon="checkmark" onPress={() => {
        void acknowledgeArchiveRecoveryCode().then(() => setRecoveryCode("")).catch((error) => setHistoryError(friendlyError(error)));
      }} secondary />
    </View>}
    {historyBusy && <View style={styles.syncBanner}><ActivityIndicator color={C.purple} size="small" /><Text style={styles.syncBannerText}>Restoring encrypted history for this device…</Text></View>}
    {!!historyError && <View style={styles.inlineNotice}><Notice text={`Some history could not be restored: ${historyError}`} tone="info" />{!!unlockDiagnostic && <Text selectable style={styles.unlockDiagnostic}>{unlockDiagnostic}</Text>}</View>}
    {!!syncError && <View style={styles.inlineNotice}><Notice text={syncError} tone="info" />{!!unlockDiagnostic && <Text selectable style={styles.unlockDiagnostic}>{unlockDiagnostic}</Text>}</View>}
    {conversation.type === "GROUP" && groupStatus && !groupStatus.joined && <View style={styles.inlineNotice}><Notice text="This device is waiting for an existing group member to add it securely. Group history already available to your account can still be restored." tone="info" /></View>}
    {conversation.type === "GROUP" && groupStatus?.error && <View style={styles.inlineNotice}><Notice text={groupStatus.error} tone="info" /></View>}
    {!!sendError && <View style={styles.inlineNotice}><Notice text={sendQueued ? `Message safely queued. Sophia will retry when the connection returns. ${sendError}` : sendError} tone="info" /></View>}
    <FlatList
      ref={listRef}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={displayMessages}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      onScroll={onScroll}
      scrollEventThrottle={100}
      onContentSizeChange={() => {
        if (autoScroll.current) listRef.current?.scrollToEnd({ animated: true });
      }}
      ListHeaderComponent={hasEarlier ? <Pressable style={styles.earlierButton} onPress={() => void loadEarlier()} disabled={loadingEarlier}>
        {loadingEarlier ? <ActivityIndicator size="small" color={C.purple} /> : <Ionicons name="chevron-up" size={15} color={C.purple} />}
        <Text style={styles.earlierText}>{loadingEarlier ? "Loading earlier messages" : "Load earlier messages"}</Text>
      </Pressable> : undefined}
      ListEmptyComponent={<View style={styles.emptyMessages}><View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={21} color={C.purple} /></View><Text style={styles.emptyTitle}>A fresh start</Text><Text style={styles.emptyCopy}>Messages are private to the people in this conversation. Send the first note when you're ready.</Text></View>}
      renderItem={({ item }) => <MessageBubble message={item} conversation={conversation} pending={pendingSends.some((send) => send.id === item.id)} />}
    />
    {conversation.type === "GROUP" && groupStatus && !groupStatus.joined ? null : (
      <NativeMediaComposer
        conversationId={conversation.id}
        joined={conversation.type !== "GROUP" || Boolean(groupStatus?.joined)}
        messages={displayMessages}
        disabled={sending || !unlocked}
        placeholder={conversation.type === "GROUP" ? "Message your group…" : "Write a message…"}
        onSendPlaintext={sendPlaintext}
      />
    )}
  </View>;
}

function MessageBubble({ message, conversation, pending }: { message: LocalMessage; conversation: Conversation; pending: boolean }) {
  const sender = message.fromMe
    ? "You"
    : conversation.type === "DIRECT"
      ? conversation.peer?.displayName || conversation.peer?.username || "Member"
      : conversation.members?.find((member) => member.userId === message.senderUserId)?.displayName
        || conversation.members?.find((member) => member.userId === message.senderUserId)?.username
        || "Member";
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(message.createdAt));
  return <View style={[styles.messageRow, message.fromMe ? styles.messageRowMine : styles.messageRowPeer]}>
    <View style={[styles.messageBubble, message.fromMe ? styles.messageBubbleMine : styles.messageBubblePeer]}>
      {conversation.type === "GROUP" && !message.fromMe && <Text style={styles.senderName}>{sender}</Text>}
      <NativeMessageBody conversationId={conversation.id} plaintext={message.plaintext} fromMe={message.fromMe} />
      <View style={styles.messageMeta}><Text style={[styles.messageTime, message.fromMe && styles.messageTimeMine]}>{pending ? "Waiting to send" : time}</Text>{message.fromMe && !pending && <Ionicons name="checkmark-done" size={13} color="#DCD2ED" />}</View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  unlockRoot: { flex: 1, justifyContent: "center", paddingHorizontal: 24, paddingBottom: 28, gap: 15 },
  unlockIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: C.greenWash },
  unlockTitle: { fontFamily: "Georgia", color: C.ink, fontSize: 26, lineHeight: 32, marginTop: 4 },
  unlockCopy: { color: C.muted, fontSize: 14, lineHeight: 21, marginBottom: 3 },
  unlockFoot: { color: C.faint, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 1 },
  unlockDiagnostic: { color: C.muted, fontFamily: "monospace", fontSize: 9, lineHeight: 13, maxHeight: 100, marginTop: 5 },
  syncBanner: { minHeight: 38, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, backgroundColor: C.paper },
  syncBannerText: { color: C.muted, fontSize: 12 },
  inlineNotice: { paddingHorizontal: 12, paddingTop: 8 },
  recoveryCard: { marginHorizontal: 12, marginTop: 10, padding: 13, gap: 9, borderRadius: 16, backgroundColor: C.amberWash, borderWidth: 1, borderColor: "#EEDDC4" },
  recoveryTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  recoveryTitle: { color: "#8C652E", fontSize: 12, fontWeight: "700" },
  recoveryCopy: { color: "#8C652E", fontSize: 10, lineHeight: 15 },
  recoveryCode: { padding: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.72)", color: C.ink, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, textAlign: "center" },
  list: { flex: 1 },
  listContent: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: 15, paddingTop: 10, paddingBottom: 18 },
  earlierButton: { alignSelf: "center", minHeight: 36, paddingHorizontal: 12, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  earlierText: { color: C.purple, fontSize: 12, fontWeight: "600" },
  emptyMessages: { alignItems: "center", justifyContent: "center", paddingHorizontal: 36, paddingVertical: 54, flexGrow: 1 },
  emptyIcon: { width: 49, height: 49, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: C.lilac, marginBottom: 14 },
  emptyTitle: { color: C.ink, fontFamily: "Georgia", fontSize: 22, marginBottom: 7 },
  emptyCopy: { color: C.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  messageRow: { width: "100%", marginBottom: 9, flexDirection: "row" },
  messageRowMine: { justifyContent: "flex-end" },
  messageRowPeer: { justifyContent: "flex-start" },
  messageBubble: { maxWidth: "84%", minWidth: 84, borderRadius: 19, paddingHorizontal: 13, paddingTop: 10, paddingBottom: 7 },
  messageBubbleMine: { backgroundColor: C.purple, borderBottomRightRadius: 6 },
  messageBubblePeer: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 6 },
  senderName: { color: C.purple, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  messageText: { color: C.ink, fontSize: 15, lineHeight: 21 },
  messageTextMine: { color: "#FFFFFF" },
  messageMeta: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 4 },
  messageTime: { color: C.faint, fontSize: 10 },
  messageTimeMine: { color: "#DDD5EB" },
});

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Keyboard,
  Modal,
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
import { listMembers } from "../../frontend/lib/crypto/group-mls";
import { memberColor, memberInitials, memberLabel, readByLabel, readersOfMessage, typingLabel } from "../../frontend/lib/group-presentation";
import { ackGroupDeliveries, mlsHistoryCursor, queueGroupMessage, queueMemberRemoval, queueSelfRemoval, syncGroup, type GroupWireBlob } from "../../frontend/lib/group-runtime";
import { attachTypingSocket, noteGroupTyping, subscribeGroupTyping } from "../../frontend/lib/group-typing-client";
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
  deleteLocalMessages,
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
import { api, openSignalingSocket, setApiCookie, type Conversation } from "./api";
import { asActivityState, currentLockDelayMs, createLockController, externalActivityActive, subscribeExternalActivity } from "./app-lock";
import { registerCallLogSender, takeQueuedCallLogs } from "./call-log-bridge";
import { appLocale, t } from "./i18n";
import { sweepDecryptedCache, wipeDecryptedCache } from "./media-cache";
import { GroupInfoScreen } from "./group-info";
import { NativeMediaComposer } from "./media-composer";
import { deleteScopes, type DeleteScope } from "./message-actions";
import { encodeSystemPayload, encodeWaitingPayload, isSystemPlaintext, isWaitingPlaintext, messagePreviewText } from "../../frontend/lib/chat-payload";
import { addReplyTarget, removeReplyTarget, toggleReplyTarget } from "./reply-selection";
import { SwipeableMessage } from "./swipeable-message";
import { buildThreadRows, type ThreadRow } from "./thread-rows";
import { useColors } from "./theme";
import { ChatGreeting } from "./chat-greeting";
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
  const colors = useColors();
  const initiallyOpen = isUnlocked();
  const hasSession = useRef(initiallyOpen);
  const [locked, setLocked] = useState(!initiallyOpen);
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
  const [replyIds, setReplyIds] = useState<string[]>([]);
  const [selectingReplies, setSelectingReplies] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LocalMessage | null>(null);
  const [menuMessage, setMenuMessage] = useState<LocalMessage | null>(null);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ message: LocalMessage; scope: DeleteScope; pending: boolean } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [leftNotice, setLeftNotice] = useState("");
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<ThreadRow>>(null);
  const awayRef = useRef(false);
  const seenNewest = useRef<string | null>(null);
  const autoScroll = useRef(true);
  const refreshInFlight = useRef(false);
  const groupHistorySynced = useRef(new Set<string>());

  useEffect(() => { setApiCookie(cookie); }, [cookie]);
  useEffect(() => {
    setReplyIds([]);
    setSelectingReplies(false);
    setDeleteTarget(null);
    setMenuMessage(null);
    setHiddenIds([]);
    setUndo(null);
    setInfoOpen(false);
    setTypingNames([]);
    setLeftNotice("");
    setMessages([]);
    setPendingSends([]);
    setAwayFromLatest(false);
    setUnreadBelow(0);
    seenNewest.current = null;
    setLocked(!isUnlocked());
  }, [conversation.id]);

  const myUserId = currentUserId();
  const displayMessages = useMemo(() => {
    const hidden = new Set(hiddenIds);
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
    const visible = mergeMessages(messages, pending).filter((message) => !hidden.has(message.id));
    if (conversation.type !== "GROUP" || !conversation.createdAt) return visible;
    if (visible.some((message) => isSystemPlaintext(message.plaintext) && message.plaintext.includes("\"created\""))) return visible;
    const admin = conversation.members?.find((member) => member.role === "ADMIN");
    return [{
      id: `created:${conversation.id}`,
      conversationId: conversation.id,
      senderDeviceId: "system",
      fromMe: false,
      plaintext: encodeSystemPayload({
        event: "created",
        actor: admin?.displayName?.trim() || admin?.username || "Someone",
        title: conversation.title ?? undefined,
      }),
      createdAt: conversation.createdAt,
    }, ...visible];
  }, [conversation, hiddenIds, messages, myUserId, pendingSends]);

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
    const after = mlsHistoryCursor(existing);
    const blobs = await loadGroupBlobs(conversation.id, deviceId, after);
    const member = conversation.members?.find((item) => item.userId === userId);
    const directory = devices.devices.map((device) => ({
      userId: device.userId,
      deviceId: device.deviceId,
      signingPublicKey: b64ToBytes(device.signingPublicKey),
      role: device.role,
      label: device.displayName?.trim() || device.username,
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

    const newlyDecrypted: LocalMessage[] = result.messages
      .filter((message) => !isWaitingPlaintext(message.plaintext))
      .map((message) => {
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
    if (result.pending) {
      const sender = devices.devices.find((device) => device.deviceId === result.pending?.senderDeviceId);
      await saveLocalMessage({
        id: result.pending.id,
        conversationId: conversation.id,
        senderDeviceId: result.pending.senderDeviceId,
        senderUserId: sender?.userId,
        fromMe: result.pending.senderDeviceId === deviceId,
        plaintext: encodeWaitingPayload({ id: result.pending.id }),
        createdAt: result.pending.createdAt,
      });
    }
    await saveSealedGroup(
      userId,
      conversation.id,
      await sealGroupRecord(vaultKey, userId, conversation.id, ackGroupDeliveries(result.record, newlyDecrypted.map((message) => message.id))),
    );
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
    return result;
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

  useEffect(() => {
    if (conversation.type !== "GROUP" || locked) return;
    const socket = openSignalingSocket();
    attachTypingSocket(socket);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string; conversationId?: string; userId?: string };
        if (payload.type === "group_typing" && payload.conversationId && payload.userId) {
          noteGroupTyping({ conversationId: payload.conversationId, userId: payload.userId });
        }
      } catch {
        // Presence frames are optional.
      }
    };
    return () => {
      attachTypingSocket(null);
      socket.close();
    };
  }, [conversation.id, conversation.type, locked]);

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    return subscribeGroupTyping((event) => {
      if (event.conversationId !== conversation.id || event.userId === currentUserId()) return;
      const member = conversation.members?.find((item) => item.userId === event.userId);
      const name = memberLabel(member);
      setTypingNames((current) => current.includes(name) ? current : [...current, name]);
      const existing = timers.get(event.userId);
      if (existing) clearTimeout(existing);
      timers.set(event.userId, setTimeout(() => {
        timers.delete(event.userId);
        setTypingNames((current) => current.filter((item) => item !== name));
      }, 4_000));
    });
  }, [conversation.id, conversation.members]);

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
      hasSession.current = true;
      setLocked(false);
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
    if (locked || !isUnlocked()) return;
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
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [flushPending, locked, refreshConversation, refreshLocal]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!alive || locked || !isUnlocked()) return;
      await flushPending();
      await refreshConversation();
    };
    const controller = createLockController({
      now: () => Date.now(),
      delayMs: () => currentLockDelayMs(),
      externalActivity: externalActivityActive,
      appState: () => asActivityState(AppState.currentState),
      onLock: () => {
        if (!alive || !isUnlocked()) return;
        Keyboard.dismiss();
        void wipeDecryptedCache();
        void lockDevice().finally(() => {
          if (alive) setLocked(true);
        });
      },
      schedule: (lockAt, fire) => {
        const timer = setTimeout(fire, Math.max(0, lockAt - Date.now()));
        return () => clearTimeout(timer);
      },
    });
    const appState = AppState.addEventListener("change", (state) => {
      controller.evaluate(asActivityState(state));
      if (state === "active") {
        void sweepDecryptedCache();
        void run();
      }
    });
    const unsubscribe = subscribeExternalActivity(() => {
      controller.evaluate(asActivityState(AppState.currentState));
    });
    return () => {
      alive = false;
      appState.remove();
      unsubscribe();
      controller.dispose();
    };
  }, [flushPending, locked, refreshConversation]);

  async function sendPlaintext(plaintext: string) {
    const text = plaintext.trim();
    if (!text || sending || locked || !isUnlocked()) return;
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
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setReplyIds([]);
      setSelectingReplies(false);
    } catch (error) {
      setSendError(friendlyError(error));
      setSendQueued(false);
      throw error;
    } finally {
      setSending(false);
    }
  }

  async function openWritableGroup() {
    const userId = currentUserId();
    const vaultKey = currentVaultKey();
    if (!userId || !vaultKey) throw new Error("Unlock this device to use group chat.");
    const sealed = await loadSealedGroup(userId, conversation.id);
    if (!sealed) throw new Error("This device is waiting for an existing group member to add it.");
    const record = await openGroupRecord(vaultKey, userId, conversation.id, sealed);
    return { userId, vaultKey, record };
  }

  async function removeGroupMember(memberUserId: string, label: string) {
    const { userId, vaultKey, record: opened } = await openWritableGroup();
    let record = opened;
    const devices = await api.groupDevices(conversation.id);
    const roster = record.session ? new Set(listMembers(record.session).map((leaf) => leaf.deviceId)) : new Set<string>();
    const actor = conversation.members?.find((member) => member.userId === userId);
    for (const device of devices.devices) {
      if (device.userId !== memberUserId || !roster.has(device.deviceId)) continue;
      record = await queueMemberRemoval(record, device.deviceId, {
        actor: actor?.displayName?.trim() || actor?.username || "Admin",
        target: label,
        targetId: memberUserId,
      });
      roster.delete(device.deviceId);
    }
    await saveSealedGroup(userId, conversation.id, await sealGroupRecord(vaultKey, userId, conversation.id, record));
    await syncGroupConversation();
    await api.removeGroupMember(conversation.id, memberUserId);
    await refreshLocal();
  }

  async function leaveGroup(actor: string) {
    const userId = currentUserId();
    if (!userId) return;
    try {
      const others = (conversation.members ?? []).filter((member) => member.userId !== userId);
      const admins = (conversation.members ?? []).filter((member) => member.role === "ADMIN");
      if (admins.length === 1 && admins[0]?.userId === userId && others.length > 0) {
        setSendError("Choose another admin before leaving this group.");
        return;
      }
      if (others.length === 0) {
        await api.removeGroupMember(conversation.id, userId);
        setLeftNotice("You left this group.");
        setInfoOpen(false);
        return;
      }
      const { vaultKey, record } = await openWritableGroup();
      const queued = await queueSelfRemoval(record, { actor });
      await saveSealedGroup(userId, conversation.id, await sealGroupRecord(vaultKey, userId, conversation.id, queued));
      const result = await syncGroupConversation();
      if (!result.selfRemoved) {
        setSendError("Leave is waiting for the group to confirm. Keep this chat open until it finishes.");
        setInfoOpen(false);
        return;
      }
      await api.removeGroupMember(conversation.id, userId);
      setLeftNotice("You left this group.");
      setInfoOpen(false);
    } catch (error) {
      setSendError(friendlyError(error));
    }
  }

  async function announceRename(title: string) {
    const userId = currentUserId();
    const actor = conversation.members?.find((member) => member.userId === userId);
    await sendPlaintext(encodeSystemPayload({
      event: "renamed",
      actor: actor?.displayName?.trim() || actor?.username || "Someone",
      actorId: userId ?? undefined,
      title,
    }));
  }

  useEffect(() => {
    if (locked || !isUnlocked()) return;
    const unregister = registerCallLogSender(async (conversationId, plaintext) => {
      if (conversationId !== conversation.id) return;
      await sendPlaintext(plaintext);
    });
    const queued = takeQueuedCallLogs(conversation.id);
    for (const item of queued) void sendPlaintext(item.plaintext).catch(() => undefined);
    return unregister;
  }, [conversation.id, locked]);

  async function finalizeDelete(message: LocalMessage, scope: DeleteScope, pending: boolean) {
    const logicalId = message.logicalMessageId ?? message.id;
    if (pending) {
      await deletePendingDirectSend(message.id);
      setPendingSends((current) => current.filter((item) => item.id !== message.id));
      return;
    }
    if (scope === "everyone") await api.deleteMessage(conversation.id, logicalId);
    await deleteLocalMessages(conversation.id, logicalId, [message.id]);
    setMessages((current) => current.filter((item) => item.id !== message.id && (item.logicalMessageId ?? item.id) !== logicalId));
  }

  function confirmDelete(scope: DeleteScope) {
    const message = deleteTarget;
    if (!message) return;
    const pending = pendingSends.some((send) => send.id === message.id);
    setDeleteTarget(null);
    setHiddenIds((current) => current.includes(message.id) ? current : [...current, message.id]);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ message, scope, pending });
    undoTimer.current = setTimeout(() => {
      setUndo(null);
      void finalizeDelete(message, scope, pending)
        .catch((error) => setSendError(friendlyError(error)))
        .finally(() => setHiddenIds((current) => current.filter((id) => id !== message.id)));
    }, 5000);
  }

  function undoDelete() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (undo) setHiddenIds((current) => current.filter((id) => id !== undo.message.id));
    setUndo(null);
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

  const rows = useMemo(
    () => [...buildThreadRows(displayMessages, new Date(), appLocale())].reverse(),
    [displayMessages],
  );

  useEffect(() => {
    const newest = displayMessages[displayMessages.length - 1];
    if (!newest) return;
    if (seenNewest.current && seenNewest.current !== newest.id && awayRef.current) {
      const previousIndex = displayMessages.findIndex((item) => item.id === seenNewest.current);
      const arrived = previousIndex === -1 ? 1 : displayMessages.length - 1 - previousIndex;
      if (arrived > 0) setUnreadBelow((count) => count + arrived);
    }
    seenNewest.current = newest.id;
  }, [displayMessages]);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const atLatest = event.nativeEvent.contentOffset.y < 80;
    autoScroll.current = atLatest;
    awayRef.current = !atLatest;
    setAwayFromLatest(!atLatest);
    if (atLatest) setUnreadBelow(0);
  }

  async function copyMessage(message: LocalMessage) {
    const text = messagePreviewText(message.plaintext);
    if (!text.trim()) return;
    const clipboard = await import("expo-clipboard");
    await clipboard.setStringAsync(text);
    void Haptics.selectionAsync().catch(() => undefined);
  }

  const unlockView = (
    <View style={[styles.unlockRoot, { backgroundColor: colors.bg }]}>
      <View style={styles.unlockIcon}><Ionicons name="lock-closed" size={23} color={C.green} /></View>
      <Text style={[styles.unlockTitle, { color: colors.ink }]}>Unlock your encrypted chats</Text>
      <Text style={[styles.unlockCopy, { color: colors.muted }]}>Enter your Sophia messaging vault password. This device will join your secure account and restore the history available to you.</Text>
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
    </View>
  );

  if (locked && !hasSession.current) return unlockView;

  const deleteEveryone = deleteTarget
    ? deleteScopes({ fromMe: Boolean(deleteTarget.fromMe), pending: pendingSends.some((send) => send.id === deleteTarget.id) }).includes("everyone")
    : false;

  return <View style={[styles.root, { backgroundColor: colors.bg }]}>
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
    {!!leftNotice && <View style={styles.inlineNotice}><Notice text={leftNotice} tone="info" /></View>}
    {conversation.type === "DIRECT" && conversation.peer ? (
      <ChatGreeting
        person={conversation.peer}
        contactId={conversation.peer.id}
        conversationId={conversation.id}
        isNew={!conversation.lastMessageAt}
        size={conversation.lastMessageAt ? 64 : 150}
      />
    ) : null}
    {conversation.type === "GROUP" ? (
      <Pressable accessibilityRole="button" accessibilityLabel={t("groupInfo")} onPress={() => setInfoOpen(true)} style={styles.groupHeader}>
        <View style={[styles.groupAvatar, { backgroundColor: memberColor(conversation.id) }]}>
          <Text style={styles.groupAvatarText}>{memberInitials(conversation.title?.trim() || "Group")}</Text>
        </View>
        <View style={styles.groupHeaderText}>
          <Text numberOfLines={1} style={[styles.groupTitle, { color: colors.ink }]}>{conversation.title?.trim() || "Group"}</Text>
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{typingLabel(typingNames) ?? `${conversation.members?.length ?? 0} members`}</Text>
        </View>
      </Pressable>
    ) : null}
    {!!sendError && <View style={styles.inlineNotice}><Notice text={sendQueued ? `Message safely queued. Sophia will retry when the connection returns. ${sendError}` : sendError} tone="info" /></View>}
    <View style={styles.listWrap}>
      <FlatList
        ref={listRef}
        inverted
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={rows}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        onScroll={onScroll}
        scrollEventThrottle={16}
        removeClippedSubviews={false}
        onEndReachedThreshold={0.2}
        onEndReached={() => {
          if (hasEarlier && !loadingEarlier) void loadEarlier();
        }}
        maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: 48 }}
        ListFooterComponent={hasEarlier ? <Pressable style={styles.earlierButton} onPress={() => void loadEarlier()} disabled={loadingEarlier}>
          {loadingEarlier ? <ActivityIndicator size="small" color={colors.purple} /> : <Ionicons name="chevron-up" size={15} color={colors.purple} />}
          <Text style={[styles.earlierText, { color: colors.purple }]}>{loadingEarlier ? t("loadingEarlier") : t("loadEarlier")}</Text>
        </Pressable> : undefined}
        ListEmptyComponent={<View style={styles.emptyMessages}><View style={[styles.emptyIcon, { backgroundColor: colors.lilac }]}><Ionicons name="chatbubble-ellipses-outline" size={21} color={colors.purple} /></View><Text style={[styles.emptyTitle, { color: colors.ink }]}>{t("emptyTitle")}</Text><Text style={[styles.emptyCopy, { color: colors.muted }]}>{t("emptyCopy")}</Text></View>}
        renderItem={({ item }) => item.kind === "date" ? (
          <View style={styles.dateRow} accessibilityRole="header">
            <View style={[styles.datePill, { backgroundColor: colors.lilac }]}><Text style={[styles.dateText, { color: colors.muted }]}>{item.label}</Text></View>
          </View>
        ) : isSystemPlaintext(item.message.plaintext) ? (
          <View style={styles.dateRow} accessibilityRole="text">
            <View style={[styles.datePill, { backgroundColor: colors.lilac }]}><Text style={[styles.dateText, { color: colors.muted }]}>{messagePreviewText(item.message.plaintext)}</Text></View>
          </View>
        ) : (
          <SwipeableMessage
            message={item.message}
            conversation={conversation}
            pending={pendingSends.some((send) => send.id === item.message.id)}
            selecting={selectingReplies}
            selected={replyIds.includes(item.message.id)}
            cluster={item.cluster}
            showSender={item.showSender}
            readLabel={conversation.type === "GROUP" && item.message.fromMe ? readByLabel(readersOfMessage(item.message, conversation.members ?? [], myUserId)) : null}
            onReply={(message) => setReplyIds((current) => addReplyTarget(current, message.id))}
            onToggleSelect={(message) => setReplyIds((current) => toggleReplyTarget(current, message.id))}
            onOpenMenu={setMenuMessage}
            onDelete={setDeleteTarget}
            onRetry={isWaitingPlaintext(item.message.plaintext) ? () => { void refreshConversation(); } : undefined}
          />
        )}
      />
      {awayFromLatest ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t("scrollToLatest")} onPress={() => {
          setUnreadBelow(0);
          setAwayFromLatest(false);
          awayRef.current = false;
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }} style={[styles.jump, { backgroundColor: colors.paper, borderColor: colors.line }]}>
          <Ionicons name="chevron-down" size={18} color={colors.purple} />
          {unreadBelow > 0 ? <View style={[styles.jumpBadge, { backgroundColor: colors.purple }]}><Text style={styles.jumpBadgeText}>{unreadBelow > 99 ? "99+" : unreadBelow}</Text></View> : null}
        </Pressable>
      ) : null}
    </View>
    {undo ? (
      <View style={styles.undoBar}>
        <Text style={styles.undoText}>{undo.scope === "everyone" ? t("deletingForEveryone") : t("deletedForYou")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("undo")} onPress={undoDelete} style={styles.undoButton}>
          <Text style={styles.undoAction}>{t("undo")}</Text>
        </Pressable>
      </View>
    ) : null}
    {conversation.type === "GROUP" && groupStatus && !groupStatus.joined ? null : (
      <NativeMediaComposer
        key={conversation.id}
        conversationId={conversation.id}
        joined={conversation.type !== "GROUP" || Boolean(groupStatus?.joined)}
        messages={displayMessages}
        disabled={sending || locked}
        placeholder={conversation.type === "GROUP" ? "Message your group…" : "Write a message…"}
        replyIds={replyIds}
        selectingReplies={selectingReplies}
        onRemoveReply={(messageId) => setReplyIds((current) => removeReplyTarget(current, messageId))}
        onToggleReply={(messageId) => setReplyIds((current) => toggleReplyTarget(current, messageId))}
        onSelectingChange={setSelectingReplies}
        onSendPlaintext={sendPlaintext}
        members={conversation.members}
        conversationType={conversation.type}
      />
    )}
    {conversation.type === "GROUP" ? (
      <GroupInfoScreen
        conversation={conversation}
        messages={displayMessages}
        selfUserId={myUserId}
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        onChanged={() => { void refreshConversation(); }}
        onLeave={(actor) => leaveGroup(actor)}
        onRemoveMember={(userId, label) => removeGroupMember(userId, label)}
        onRenamed={(title) => announceRename(title)}
      />
    ) : null}
    {locked ? <View style={[styles.lockOverlay, { backgroundColor: colors.bg }]}>{unlockView}</View> : null}
    <Modal visible={Boolean(deleteTarget)} transparent animationType="slide" onRequestClose={() => setDeleteTarget(null)}>
      <Pressable style={[styles.scrim, { backgroundColor: colors.scrim }]} onPress={() => setDeleteTarget(null)} />
      <View style={[styles.sheet, { backgroundColor: colors.paper }]}>
        <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
        <Text style={[styles.sheetTitle, { color: colors.ink }]}>{t("deleteTitle")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("deleteForMe")} onPress={() => confirmDelete("me")} style={styles.sheetButton}>
          <Text style={styles.sheetDanger}>{t("deleteForMe")}</Text>
        </Pressable>
        {deleteEveryone ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("deleteForEveryone")} onPress={() => confirmDelete("everyone")} style={styles.sheetButton}>
            <Text style={styles.sheetDanger}>{t("deleteForEveryone")}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={() => setDeleteTarget(null)} style={styles.sheetButton}>
          <Text style={[styles.sheetCancel, { color: colors.muted }]}>{t("cancel")}</Text>
        </Pressable>
      </View>
    </Modal>
    <Modal visible={Boolean(menuMessage)} transparent animationType="slide" onRequestClose={() => setMenuMessage(null)}>
      <Pressable style={[styles.scrim, { backgroundColor: colors.scrim }]} onPress={() => setMenuMessage(null)} />
      <View style={[styles.sheet, { backgroundColor: colors.paper }]}>
        <View style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
        <Pressable accessibilityRole="button" accessibilityLabel={t("reply")} onPress={() => {
          if (!menuMessage) return;
          setReplyIds((current) => addReplyTarget(current, menuMessage.id));
          setMenuMessage(null);
        }} style={styles.sheetButton}><Text style={[styles.sheetLabel, { color: colors.ink }]}>{t("reply")}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("copy")} onPress={() => {
          if (!menuMessage) return;
          const target = menuMessage;
          setMenuMessage(null);
          void copyMessage(target);
        }} style={styles.sheetButton}><Text style={[styles.sheetLabel, { color: colors.ink }]}>{t("copy")}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("select")} onPress={() => {
          if (!menuMessage) return;
          setSelectingReplies(true);
          setReplyIds((current) => addReplyTarget(current, menuMessage.id));
          setMenuMessage(null);
        }} style={styles.sheetButton}><Text style={[styles.sheetLabel, { color: colors.ink }]}>{t("select")}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("delete")} onPress={() => {
          if (!menuMessage) return;
          setDeleteTarget(menuMessage);
          setMenuMessage(null);
        }} style={styles.sheetButton}><Text style={styles.sheetDanger}>{t("delete")}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={() => setMenuMessage(null)} style={styles.sheetButton}>
          <Text style={[styles.sheetCancel, { color: colors.muted }]}>{t("cancel")}</Text>
        </Pressable>
      </View>
    </Modal>
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
  callBar: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  callButton: { minHeight: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, flexDirection: "row", alignItems: "center", gap: 6 },
  callText: { color: C.ink, fontSize: 12, fontWeight: "700" },
  deleteCard: { marginHorizontal: 12, marginTop: 8, padding: 12, borderRadius: 16, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, gap: 8 },
  deleteTitle: { color: C.ink, fontSize: 14, fontWeight: "700" },
  deleteActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  deleteChoice: { minHeight: 34, paddingHorizontal: 10, borderRadius: 999, backgroundColor: C.bg, justifyContent: "center" },
  deleteChoiceText: { color: "#B42318", fontSize: 12, fontWeight: "700" },
  deleteCancel: { color: C.muted, fontSize: 12, fontWeight: "700" },
  undoBar: { marginHorizontal: 12, marginTop: 8, minHeight: 40, borderRadius: 14, backgroundColor: "#241C33", paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  undoText: { color: "#FFFFFF", fontSize: 12 },
  undoAction: { color: "#E4D7FF", fontSize: 12, fontWeight: "800" },
  listWrap: { flex: 1 },
  list: { flex: 1 },
  listContent: { flexGrow: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  groupAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  groupAvatarText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  groupHeaderText: { flex: 1 },
  groupTitle: { fontSize: 16, fontWeight: "700" },
  dateRow: { alignItems: "center", marginVertical: 10 },
  datePill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  dateText: { fontSize: 12, fontWeight: "700" },
  jump: { position: "absolute", end: 16, bottom: 12, width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  jumpBadge: { position: "absolute", top: -4, end: -4, minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  jumpBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  lockOverlay: { ...StyleSheet.absoluteFill },
  scrim: { flex: 1 },
  sheet: { borderTopStartRadius: 22, borderTopEndRadius: 22, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  sheetTitle: { fontSize: 16, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  sheetButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  sheetLabel: { fontSize: 16, fontWeight: "600" },
  sheetDanger: { color: "#B42318", fontSize: 16, fontWeight: "700" },
  sheetCancel: { fontSize: 16, fontWeight: "600" },
  undoButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
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

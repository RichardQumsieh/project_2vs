"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PersonAvatar } from "@/components/avatar/person-avatar";
import { GroupComposer } from "@/components/group-composer";
import { GroupInfo } from "@/components/group-info";
import { GroupMessageBody } from "@/components/group-message-body";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api, type Conversation, type PublicUser } from "@/lib/api";
import { encodeSystemPayload, encodeWaitingPayload, isWaitingPlaintext } from "@/lib/chat-payload";
import { b64ToBytes } from "@/lib/crypto/bytes";
import { openGroupRecord, sealGroupRecord } from "@/lib/crypto/group-store";
import { listMembers, listRoster, type GroupRole } from "@/lib/crypto/group-mls";
import { BidiText, LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";
import { memberSearchNeedle } from "@/lib/people";
import {
  ackGroupDeliveries,
  queueGroupMessage,
  queueMemberRemoval,
  queueSelfRemoval,
  shouldReloadGroupBlobs,
  syncGroup,
  type GroupPost,
  type GroupSyncMessage,
} from "@/lib/group-runtime";
import { buildGroupRows, memberColor, memberInitials, memberLabel as presentationLabel, readByLabel, readersOfMessage, typingLabel } from "@/lib/group-presentation";
import { subscribeGroupTyping } from "@/lib/group-typing-client";
import { loadSealedGroup, saveLocalMessage, saveSealedGroup, listLocalMessages } from "@/lib/idb";
import {
  currentDeviceId,
  currentSigningMaterial,
  currentUserId,
  currentVaultKey,
  archiveGroupMessages,
} from "@/lib/session";
import type { LocalMessage } from "@/lib/crypto/types";

export function GroupUnavailable() {
  const { t } = useI18n();
  return (
    <div className="grid h-full place-items-center p-8 text-center text-sm text-white/70">
      {t("group.unavailable")}
    </div>
  );
}

export function NewGroupForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [matches, setMatches] = useState<PublicUser[]>([]);
  const [error, setError] = useState<MessageKey | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      return api.createGroup({
        title: title.trim() || undefined,
        ...(people.length > 0 ? { memberUserIds: people.map((person) => person.id) } : {}),
      });
    },
    onSuccess: async (conversation) => {
      setTitle("");
      setQuery("");
      setPeople([]);
      setMatches([]);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/inbox/${conversation.id}`);
    },
    onError: (cause) => {
      setError("group.createFailed");
      console.warn("Could not create the group", cause);
    },
  });

  useEffect(() => {
    const needle = memberSearchNeedle(query);
    if (needle.length < 2) {
      setMatches([]);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      void api.lookupPeople(needle).then((page) => {
        if (cancel) return;
        setMatches(page.users.filter((user) => !people.some((picked) => picked.id === user.id)));
      }).catch(() => {
        if (!cancel) setMatches([]);
      });
    }, 200);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [people, query]);

  return (
    <form
      className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <p className="text-xs font-medium text-white/70">{t("group.new")}</p>
      <Input
        aria-label={t("group.name")}
        title={t("group.name")}
        placeholder={t("group.name")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={80}
      />
      <Input
        aria-label={t("group.usernames")}
        title={t("group.usernames")}
        placeholder={t("group.usernames")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        dir="ltr"
        className="text-start"
      />
      {people.length > 0 ? (
        <ul className="space-y-1" aria-label={t("group.selected")}>
          {people.map((person) => {
            const label = person.displayName?.trim() || person.username;
            return (
              <li key={person.id} className="flex items-center justify-between gap-2 text-xs text-white/80">
                <span className="min-w-0 truncate">
                  <BidiText>{label}</BidiText> <LtrIsolate>@{person.username}</LtrIsolate>
                </span>
                <button
                  type="button"
                  className="shrink-0 underline"
                  title={t("group.removePick", { name: label })}
                  aria-label={t("group.removePick", { name: label })}
                  onClick={() => setPeople((current) => current.filter((item) => item.id !== person.id))}
                >
                  {t("group.remove")}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {matches.length > 0 ? (
        <ul className="space-y-1">
          {matches.map((person) => {
            const label = person.displayName?.trim() || person.username;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  className="w-full rounded-xl px-2 py-1 text-start text-xs text-white/80 hover:bg-white/10"
                  title={t("group.pick", { name: label })}
                  aria-label={t("group.pick", { name: `${label} @${person.username}` })}
                  onClick={() => {
                    setPeople((current) => current.some((item) => item.id === person.id) ? current : [...current, person]);
                    setQuery("");
                    setMatches([]);
                  }}
                >
                  <BidiText>{label}</BidiText> <LtrIsolate>@{person.username}</LtrIsolate>
                </button>
              </li>
            );
          })}
        </ul>
      ) : memberSearchNeedle(query).length >= 2 ? (
        <p className="text-xs text-white/45">{t("group.noMatch")}</p>
      ) : null}
      <Button type="submit" size="sm" disabled={create.isPending} title={t("group.create")} aria-label={t("group.create")}>
        {create.isPending ? t("group.creating") : t("group.create")}
      </Button>
      {error ? <p className="text-sm text-red-300">{t(error)}</p> : null}
    </form>
  );
}

type GroupNotice = "group.unlock" | "group.left" | "group.membersOnly" | "group.waitingAdmin";

export function GroupThread({ conversation }: { conversation: Conversation }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [actionError, setActionError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [sending, setSending] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const userId = currentUserId();
  const me = conversation.members?.find((member) => member.userId === userId);
  const isAdmin = me?.role === "ADMIN";

  const sync = useQuery({
    queryKey: ["group-sync", conversation.id, userId],
    enabled: Boolean(userId),
    // Realtime invalidation covers live traffic; polling is a backstop only.
    // Keep this well under the API's 120 req/min budget (each sync hits several routes).
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    queryFn: () => refreshGroup(conversation, queryClient),
  });
  const mlsRole = sync.data?.mlsRole ?? null;
  const canAdminister = isAdmin && mlsRole === "admin";

  const messages = sync.data?.messages ?? [];
  const joined = sync.data?.joined ?? false;
  const status = sync.data?.status
    ? t(sync.data.status)
    : sync.isLoading
      ? t("group.opening")
      : null;
  const error = actionError
    ? t(actionError)
    : sync.data?.error
      ? sync.data.error
      : sync.error
        ? t("group.syncFailed")
        : null;

  useEffect(() => {
    const timers = new Map<string, number>();
    return subscribeGroupTyping((event) => {
      if (event.conversationId !== conversation.id || event.userId === userId) return;
      const member = conversation.members?.find((item) => item.userId === event.userId);
      const name = presentationLabel(member, t("group.member"));
      setTypingNames((current) => current.includes(name) ? current : [...current, name]);
      const existing = timers.get(event.userId);
      if (existing) window.clearTimeout(existing);
      timers.set(event.userId, window.setTimeout(() => {
        timers.delete(event.userId);
        setTypingNames((current) => current.filter((item) => item !== name));
      }, 4_000));
    });
  }, [conversation.id, conversation.members, t, userId]);

  async function renameGroup(title: string) {
    if (!title || !userId) return;
    setActionError(null);
    try {
      await api.renameGroup(conversation.id, title);
      const actor = me?.displayName?.trim() || me?.username || "Someone";
      await sendPlaintext(encodeSystemPayload({ event: "renamed", actor, actorId: userId, title }));
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (cause) {
      setActionError("group.sendFailed");
      console.warn("Could not rename the group", cause);
    }
  }

  function requestGroupNotifications() {
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    void Notification.requestPermission();
  }

  async function sendPlaintext(plaintext: string) {
    if (!userId) throw new Error("Unlock this device before messaging the group.");
    requestGroupNotifications();
    setActionError(null);
    setNotice(null);
    setSending(true);
    try {
      const key = requireVault();
      const sealed = await loadSealedGroup(userId, conversation.id);
      if (!sealed) {
        setActionError("group.notJoined");
        throw new Error("Join the group before sending.");
      }
      const record = await openGroupRecord(key, userId, conversation.id, sealed);
      const queued = await queueGroupMessage(record, plaintext);
      await saveSealedGroup(
        userId,
        conversation.id,
        await sealGroupRecord(key, userId, conversation.id, queued),
      );
      await queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] });
    } catch (cause) {
      setActionError("group.sendFailed");
      console.warn("Could not send the group message", cause);
      throw cause instanceof Error ? cause : new Error("Could not send the group message.");
    } finally {
      setSending(false);
    }
  }

  async function addPerson(person: PublicUser) {
    setActionError(null);
    setNotice(null);
    try {
      await api.addGroupMember(conversation.id, { userId: person.id });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] });
    } catch (cause) {
      setActionError("group.addFailed");
      console.warn("Could not add the group member", cause);
    }
  }

  async function setMemberRole(memberUserId: string, role: "ADMIN" | "MEMBER") {
    setActionError(null);
    setNotice(null);
    try {
      await api.setGroupMemberRole(conversation.id, memberUserId, role);
      setNotice("group.rolePending");
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] });
    } catch (cause) {
      setActionError(cause instanceof ApiError && cause.code === "last_admin" ? "group.lastAdmin" : "group.roleFailed");
      console.warn("Could not change the group role", cause);
    }
  }

  async function removeMember(memberUserId: string) {
    if (!userId || !canAdminister) return;
    setActionError(null);
    setNotice(null);
    try {
      const key = requireVault();
      const sealed = await loadSealedGroup(userId, conversation.id);
      if (sealed) {
        let record = await openGroupRecord(key, userId, conversation.id, sealed);
        const devices = await api.groupDevices(conversation.id);
        const roster = record.session ? new Set(listMembers(record.session).map((leaf) => leaf.deviceId)) : new Set<string>();
        for (const device of devices.devices) {
          if (device.userId !== memberUserId || !roster.has(device.deviceId)) continue;
          record = await queueMemberRemoval(record, device.deviceId, {
            actor: me?.displayName?.trim() || me?.username || "Admin",
            target: device.displayName?.trim() || device.username || "A member",
            targetId: device.userId,
          });
          roster.delete(device.deviceId);
        }
        await saveSealedGroup(
          userId,
          conversation.id,
          await sealGroupRecord(key, userId, conversation.id, record),
        );
        await refreshGroup(conversation, queryClient);
      }
      await api.removeGroupMember(conversation.id, memberUserId);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] });
    } catch (cause) {
      setActionError("group.removeFailed");
      console.warn("Could not remove the group member", cause);
    }
  }

  async function leaveGroup() {
    if (!userId) return;
    const others = (conversation.members ?? []).filter((member) => member.userId !== userId);
    const admins = (conversation.members ?? []).filter((member) => member.role === "ADMIN");
    if (admins.length === 1 && admins[0]?.userId === userId && others.length > 0) {
      setActionError("group.lastAdmin");
      return;
    }
    setActionError(null);
    setNotice(null);
    if (others.length === 0) {
      try {
        await api.removeGroupMember(conversation.id, userId);
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
        router.push("/inbox");
      } catch (cause) {
        setActionError("group.leaveFailed");
        console.warn("Could not leave the group", cause);
      }
      return;
    }
    try {
      const key = requireVault();
      const sealed = await loadSealedGroup(userId, conversation.id);
      if (!sealed) {
        await api.removeGroupMember(conversation.id, userId);
        router.push("/inbox");
        return;
      }
      const record = await openGroupRecord(key, userId, conversation.id, sealed);
      if (!record.session || record.session.state.groupActiveState.kind === "removedFromGroup") {
        await api.removeGroupMember(conversation.id, userId);
        router.push("/inbox");
        return;
      }
      const queued = await queueSelfRemoval(record, {
        actor: me?.displayName?.trim() || me?.username || "A member",
      });
      await saveSealedGroup(userId, conversation.id, await sealGroupRecord(key, userId, conversation.id, queued));
      const result = await refreshGroup(conversation, queryClient);
      if (result.selfRemoved) {
        await api.removeGroupMember(conversation.id, userId);
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
        router.push("/inbox");
        return;
      }
      setActionError("group.leavePending");
      await queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] });
    } catch (cause) {
      setActionError("group.leaveFailed");
      console.warn("Could not leave the group", cause);
    }
  }

  const titleText = conversation.title?.trim() || t("group.fallbackTitle");
  const usernames = (conversation.members ?? []).map((member) => member.username);
  const rows = buildGroupRows(messages, new Date(), undefined, conversation.createdAt ? {
    at: conversation.createdAt,
    title: conversation.title,
    actor: conversation.members?.find((member) => member.role === "ADMIN")?.displayName
      || conversation.members?.find((member) => member.role === "ADMIN")?.username,
  } : null);
  const typing = typingLabel(typingNames);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="border-b border-white/10 px-2 py-2">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-start hover:bg-white/[0.04]"
          onClick={() => setInfoOpen(true)}
          title={t("group.info")}
          aria-label={t("group.info")}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: memberColor(conversation.id) }}>
            {memberInitials(titleText)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium"><BidiText>{titleText}</BidiText></span>
            <span className="block truncate text-xs text-white/45">
              <BidiText>{typing || t("group.encryptedLine", { count: (conversation.members ?? []).length })}</BidiText>
            </span>
          </span>
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {rows.length === 0 ? (
          <p className="text-sm text-white/45">{joined ? t("group.empty") : status}</p>
        ) : rows.map((row) => {
          if (row.kind === "date") {
            return <p key={row.id} className="py-2 text-center text-[11px] font-medium text-white/45">{row.label}</p>;
          }
          if (row.kind === "system") {
            return <p key={row.id} className="py-1 text-center text-xs text-white/50">{row.text}</p>;
          }
          const message = row.message;
          const sender = conversation.members?.find((member) => member.userId === message.senderUserId);
          const name = message.fromMe ? t("group.you") : presentationLabel(sender, t("group.member"));
          const color = memberColor(message.senderUserId || message.senderDeviceId);
          const readers = message.fromMe ? readByLabel(readersOfMessage(message, conversation.members ?? [], userId)) : null;
          return (
            <article
              key={row.id}
              className={`flex max-w-[36rem] items-end gap-2 ${message.fromMe ? "ms-auto flex-row-reverse" : ""} ${row.cluster === "middle" || row.cluster === "first" ? "mb-0.5" : "mb-2"}`}
            >
              {row.showSender ? (
                <PersonAvatar person={sender} title={memberInitials(name)} size={32} />
              ) : <span className="size-8 shrink-0" aria-hidden="true" />}
              <div className={`min-w-0 rounded-2xl px-3 py-2 text-sm ${message.fromMe ? "bg-cyan-300/15" : "bg-white/[0.04]"}`}>
                {row.showSender ? <p className="mb-1 text-[11px] font-semibold" style={{ color }}><BidiText>{name}</BidiText></p> : null}
                <GroupMessageBody
                  conversationId={conversation.id}
                  plaintext={message.plaintext}
                  fromMe={Boolean(message.fromMe)}
                  usernames={usernames}
                  onRetry={() => void queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] })}
                />
                <p className="mt-1 text-end text-[10px] text-white/40">
                  {readers || (message.fromMe ? t("group.sent") : "")}
                </p>
              </div>
            </article>
          );
        })}
      </div>
      {status && joined ? <p className="px-4 text-xs text-white/45">{status}</p> : null}
      {notice ? <p className="px-4 text-xs text-white/55">{t(notice)}</p> : null}
      {error ? <p className="px-4 text-sm text-red-300">{error}</p> : null}
      <GroupComposer
        conversationId={conversation.id}
        joined={joined}
        messages={messages}
        members={conversation.members}
        disabled={sending}
        onSendPlaintext={sendPlaintext}
      />
      {infoOpen ? (
        <GroupInfo
          conversation={conversation}
          messages={messages}
          canAdminister={canAdminister}
          selfUserId={userId}
          onClose={() => setInfoOpen(false)}
          onRename={renameGroup}
          onAdd={addPerson}
          onRemove={removeMember}
          onSetRole={setMemberRole}
          onLeave={async () => { await leaveGroup(); }}
        />
      ) : null}
    </div>
  );
}

function requireVault() {
  const key = currentVaultKey();
  if (!key) throw new Error("Unlock this device before using the group.");
  return key;
}

async function loadBlobs(conversationId: string, deviceId: string) {
  const blobs = [];
  let after: string | undefined;
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await api.groupMls(conversationId, deviceId, after);
    blobs.push(...page.blobs);
    if (page.blobs.length < 100) return blobs;
    const next = page.blobs[page.blobs.length - 1]?.id;
    if (!next || next === after) return blobs;
    after = next;
  }
  return blobs;
}

type GroupRefreshResult = {
  messages: LocalMessage[];
  joined: boolean;
  status: GroupNotice | null;
  error: string | null;
  selfRemoved: boolean;
  mlsRole: GroupRole | null;
};

/**
 * Single-flight group refresh with a trailing re-run.
 * Realtime invalidation, the 15s poll, and send() must not stack parallel MLS
 * syncs (that hit the API 120/min ceiling and returned 429).
 */
const groupRefreshJobs = new Map<
  string,
  { inFlight: Promise<GroupRefreshResult>; pending: boolean }
>();

async function refreshGroup(
  conversation: Conversation,
  queryClient: { invalidateQueries: (filters: { queryKey: string[] }) => Promise<unknown> },
): Promise<GroupRefreshResult> {
  const existing = groupRefreshJobs.get(conversation.id);
  if (existing) {
    existing.pending = true;
    return existing.inFlight;
  }

  const job: { inFlight: Promise<GroupRefreshResult>; pending: boolean } = {
    inFlight: null as unknown as Promise<GroupRefreshResult>,
    pending: false,
  };
  job.inFlight = (async () => {
    let result: GroupRefreshResult;
    for (;;) {
      job.pending = false;
      result = await runGroupRefresh(conversation, queryClient);
      if (!job.pending) {
        if (groupRefreshJobs.get(conversation.id) === job) {
          groupRefreshJobs.delete(conversation.id);
        }
        return result;
      }
    }
  })();
  groupRefreshJobs.set(conversation.id, job);
  return job.inFlight;
}

async function runGroupRefresh(
  conversation: Conversation,
  queryClient: { invalidateQueries: (filters: { queryKey: string[] }) => Promise<unknown> },
): Promise<GroupRefreshResult> {
  const userId = currentUserId();
  const signing = currentSigningMaterial();
  const key = currentVaultKey();
  if (!userId || !signing || !key) {
    return {
      messages: [],
      joined: false,
      status: "group.unlock",
      error: null,
      selfRemoved: false,
      mlsRole: null,
    };
  }
  const deviceId = currentDeviceId();
  const role: GroupRole =
    conversation.members?.find((member) => member.userId === userId)?.role === "ADMIN"
      ? "admin"
      : "member";

  let devices;
  let initialBlobs;
  let sealed;
  try {
    [devices, initialBlobs, sealed] = await Promise.all([
      api.groupDevices(conversation.id),
      loadBlobs(conversation.id, deviceId),
      loadSealedGroup(userId, conversation.id),
    ]);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 429) {
      return {
        messages: await listLocalMessages(conversation.id, 100),
        joined: false,
        status: null,
        error: "The server asked this tab to slow down. Messages already on this device are still shown; retry shortly.",
        selfRemoved: false,
        mlsRole: null,
      };
    }
    throw cause;
  }

  const existing = sealed ? await openGroupRecord(key, userId, conversation.id, sealed) : null;
  const directory = devices.devices.map((device) => ({
    userId: device.userId,
    deviceId: device.deviceId,
    signingPublicKey: b64ToBytes(device.signingPublicKey),
    role: device.role,
    label: device.displayName?.trim() || device.username,
  }));
  const post = (body: GroupPost) =>
    api.postGroupMls(conversation.id, { ...body, senderDeviceId: deviceId });
  const syncInput = {
    userId,
    deviceId,
    role,
    conversationId: conversation.id,
    signingPrivateJwk: signing.privateJwk,
    signingPublicKey: signing.publicKey,
    memberUserIds: conversation.memberUserIds ?? [userId],
    directory,
    post,
  } as const;

  let blobs = initialBlobs;
  let result = await syncGroup({
    ...syncInput,
    record: existing,
    blobs,
  });
  // Keep plaintext from every sync pass — a reload must not drop the first pass.
  const decryptedWire: GroupSyncMessage[] = [...result.messages];

  // Only after an epoch race: one blob reload. Never because outbox still has work.
  if (shouldReloadGroupBlobs(result)) {
    try {
      blobs = await loadBlobs(conversation.id, deviceId);
      result = await syncGroup({
        ...syncInput,
        record: result.record,
        blobs,
      });
      decryptedWire.push(...result.messages);
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 429)) throw cause;
      // Keep first-pass state; surface a soft error instead of wiping the thread.
      result = {
        ...result,
        error: result.error ?? "The server asked this tab to slow down. Retry shortly.",
      };
    }
  }

  const newlyDecrypted: LocalMessage[] = [];
  const seen = new Set<string>();
  for (const message of decryptedWire) {
    if (seen.has(message.id) || isWaitingPlaintext(message.plaintext)) continue;
    seen.add(message.id);
    const sender = devices.devices.find((device) => device.deviceId === message.senderDeviceId);
    const local = localFrom(conversation.id, message, deviceId, sender?.userId);
    newlyDecrypted.push(local);
    await saveLocalMessage(local);
  }
  const pending = result.pending;
  if (pending && !seen.has(pending.id)) {
    const sender = devices.devices.find((device) => device.deviceId === pending.senderDeviceId);
    await saveLocalMessage({
      id: pending.id,
      conversationId: conversation.id,
      senderDeviceId: pending.senderDeviceId,
      senderUserId: sender?.userId,
      fromMe: pending.senderDeviceId === deviceId,
      plaintext: encodeWaitingPayload({ id: pending.id }),
      createdAt: pending.createdAt,
    });
  }
  const storedRecord = ackGroupDeliveries(result.record, newlyDecrypted.map((message) => message.id));
  await saveSealedGroup(
    userId,
    conversation.id,
    await sealGroupRecord(key, userId, conversation.id, storedRecord),
  );
  try {
    await archiveGroupMessages(newlyDecrypted);
  } catch (cause) {
    // Archive is best-effort for display; do not hide already-decrypted messages.
    console.warn("Could not archive group messages", cause);
  }

  const messages = await listLocalMessages(conversation.id, 100);
  const selfRemoved = result.selfRemoved;
  const joined = Boolean(result.record.session) && !selfRemoved;
  const mlsRole = result.record.session
    ? listRoster(result.record.session).find((leaf) => leaf.deviceId === deviceId)?.role ?? null
    : null;
  const latestBlobId = blobs[blobs.length - 1]?.id;
  if (joined && latestBlobId && markedGroupRead.get(conversation.id) !== latestBlobId) {
    try {
      await api.markGroupRead(conversation.id, latestBlobId);
      markedGroupRead.set(conversation.id, latestBlobId);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (cause) {
      console.warn("Could not mark the group read", cause);
    }
  }
  return {
    messages,
    joined,
    status: selfRemoved
      ? "group.left"
      : result.record.session
        ? "group.membersOnly"
        : "group.waitingAdmin",
    error: result.error,
    selfRemoved,
    mlsRole,
  };
}

const markedGroupRead = new Map<string, string>();

function localFrom(
  conversationId: string,
  message: GroupSyncMessage,
  deviceId: string,
  senderUserId: string | undefined,
): LocalMessage {
  return {
    id: message.id,
    conversationId,
    senderDeviceId: message.senderDeviceId,
    senderUserId,
    fromMe: message.senderDeviceId === deviceId,
    plaintext: message.plaintext,
    createdAt: message.createdAt,
  };
}

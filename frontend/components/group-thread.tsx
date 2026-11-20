"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, type Conversation } from "@/lib/api";
import { b64ToBytes } from "@/lib/crypto/bytes";
import { openGroupRecord, sealGroupRecord } from "@/lib/crypto/group-store";
import { listMembers } from "@/lib/crypto/group-mls";
import { BidiText, LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";
import {
  queueGroupMessage,
  queueMemberRemoval,
  queueSelfRemoval,
  syncGroup,
  type GroupSyncMessage,
} from "@/lib/group-runtime";
import { loadSealedGroup, saveLocalMessage, saveSealedGroup, listLocalMessages } from "@/lib/idb";
import {
  currentDeviceId,
  currentSigningMaterial,
  currentUserId,
  currentVaultKey,
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
  const [usernames, setUsernames] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const memberUsernames = usernames
        .split(/[\s,]+/)
        .map((name) => name.trim().replace(/^@/, ""))
        .filter(Boolean);
      return api.createGroup({
        title: title.trim() || undefined,
        ...(memberUsernames.length > 0 ? { memberUsernames } : {}),
      });
    },
    onSuccess: async (conversation) => {
      setTitle("");
      setUsernames("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/inbox/${conversation.id}`);
    },
    onError: (cause) => {
      setError("group.createFailed");
      console.warn("Could not create the group", cause);
    },
  });

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
        placeholder={t("group.name")}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={80}
      />
      <Input
        aria-label={t("group.usernames")}
        placeholder={t("group.usernames")}
        value={usernames}
        onChange={(event) => setUsernames(event.target.value)}
        dir="ltr"
        className="text-start"
      />
      <Button type="submit" size="sm" disabled={create.isPending}>
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
  const [draft, setDraft] = useState("");
  const [username, setUsername] = useState("");
  const [actionError, setActionError] = useState<MessageKey | null>(null);
  const userId = currentUserId();
  const me = conversation.members?.find((member) => member.userId === userId);
  const isAdmin = me?.role === "ADMIN";

  const sync = useQuery({
    queryKey: ["group-sync", conversation.id, userId],
    enabled: Boolean(userId),
    refetchInterval: 4000,
    queryFn: () => refreshGroup(conversation),
  });

  const messages = sync.data?.messages ?? [];
  const joined = sync.data?.joined ?? false;
  const status = sync.data?.status
    ? t(sync.data.status)
    : sync.isLoading
      ? t("group.opening")
      : null;
  const error = actionError
    ? t(actionError)
    : sync.data?.error || sync.error
      ? t("group.syncFailed")
      : null;

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !userId) return;
    setActionError(null);
    try {
      const key = requireVault();
      const sealed = await loadSealedGroup(userId, conversation.id);
      if (!sealed) {
        setActionError("group.notJoined");
        return;
      }
      const record = await openGroupRecord(key, userId, conversation.id, sealed);
      const queued = await queueGroupMessage(record, text);
      await saveSealedGroup(userId, conversation.id, await sealGroupRecord(key, userId, conversation.id, queued));
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] });
    } catch (cause) {
      setActionError("group.sendFailed");
      console.warn("Could not send the group message", cause);
    }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    const name = username.trim().replace(/^@/, "");
    if (!name) return;
    setActionError(null);
    try {
      await api.addGroupMember(conversation.id, { username: name });
      setUsername("");
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] });
    } catch (cause) {
      setActionError("group.addFailed");
      console.warn("Could not add the group member", cause);
    }
  }

  async function removeMember(memberUserId: string) {
    if (!userId) return;
    setActionError(null);
    try {
      const key = requireVault();
      const sealed = await loadSealedGroup(userId, conversation.id);
      if (sealed) {
        let record = await openGroupRecord(key, userId, conversation.id, sealed);
        const devices = await api.groupDevices(conversation.id);
        const roster = record.session ? new Set(listMembers(record.session).map((leaf) => leaf.deviceId)) : new Set<string>();
        for (const device of devices.devices) {
          if (device.userId !== memberUserId || !roster.has(device.deviceId)) continue;
          record = await queueMemberRemoval(record, device.deviceId);
          roster.delete(device.deviceId);
        }
        await saveSealedGroup(
          userId,
          conversation.id,
          await sealGroupRecord(key, userId, conversation.id, record),
        );
        await refreshGroup(conversation);
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
      const queued = await queueSelfRemoval(record);
      await saveSealedGroup(userId, conversation.id, await sealGroupRecord(key, userId, conversation.id, queued));
      const result = await refreshGroup(conversation);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">
            <BidiText>{conversation.title?.trim() || t("group.fallbackTitle")}</BidiText>
          </h1>
          <p className="truncate text-xs text-white/45">
            <BidiText>{t("group.encryptedLine", { count: (conversation.members ?? []).length })}</BidiText>
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void leaveGroup()}>
          {t("group.leave")}
        </Button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <p className="text-sm text-white/45">
                {joined ? t("group.empty") : status}
              </p>
            ) : messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[36rem] rounded-2xl px-3 py-2 text-sm ${
                  message.fromMe ? "ms-auto bg-cyan-300/15" : "bg-white/[0.04]"
                }`}
              >
                <p className="mb-1 text-[11px] text-white/40">
                  <BidiText>
                    {message.fromMe ? t("group.you") : memberLabel(conversation, message, t("group.member"))}
                  </BidiText>
                </p>
                <p className="whitespace-pre-wrap break-words"><BidiText>{message.plaintext}</BidiText></p>
              </article>
            ))}
          </div>
          <form className="flex gap-2 border-t border-white/10 p-3" onSubmit={(event) => void sendMessage(event)}>
            <Input
              aria-label={t("group.messageLabel")}
              placeholder={joined ? t("group.messagePlaceholder") : t("group.waitingJoin")}
              value={draft}
              disabled={!joined}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={16000}
              dir="auto"
            />
            <Button type="submit" size="sm" disabled={!joined || draft.trim().length === 0}>
              {t("group.send")}
            </Button>
          </form>
        </div>
        <aside className="border-t border-white/10 p-4 md:border-t-0 md:border-s">
          <h2 className="text-xs font-medium uppercase tracking-wide text-white/45">{t("group.members")}</h2>
          <ul className="mt-3 space-y-2">
            {(conversation.members ?? []).map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">
                    <BidiText>{member.displayName?.trim() || member.username}</BidiText>
                  </span>
                  <span className="block truncate text-xs text-white/40">
                    <LtrIsolate>@{member.username}</LtrIsolate>
                    {" · "}
                    {member.role === "ADMIN" ? t("group.admin") : t("group.member")}
                  </span>
                </span>
                {isAdmin && member.userId !== userId ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void removeMember(member.userId)}>
                    {t("group.remove")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {isAdmin ? (
            <form className="mt-4 space-y-2" onSubmit={(event) => void addMember(event)}>
              <Input
                aria-label={t("group.addLabel")}
                placeholder={t("group.addPlaceholder")}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                dir="ltr"
              />
              <Button type="submit" size="sm" variant="outline">{t("group.add")}</Button>
            </form>
          ) : null}
          {status && joined ? <p className="mt-3 text-xs text-white/45">{status}</p> : null}
          {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        </aside>
      </div>
    </div>
  );
}

function memberLabel(conversation: Conversation, message: LocalMessage, fallback: string) {
  const member = conversation.members?.find((item) => item.userId === message.senderUserId);
  return member?.displayName?.trim() || (member ? `@${member.username}` : fallback);
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
    const next = page.blobs.at(-1)?.id;
    if (!next || next === after) return blobs;
    after = next;
  }
  return blobs;
}

async function refreshGroup(conversation: Conversation): Promise<{
  messages: LocalMessage[];
  joined: boolean;
  status: GroupNotice | null;
  error: string | null;
  selfRemoved: boolean;
}> {
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
    };
  }
  const deviceId = currentDeviceId();
  const role = conversation.members?.find((member) => member.userId === userId)?.role === "ADMIN"
    ? "admin"
    : "member";
  const [devices, blobs, sealed] = await Promise.all([
    api.groupDevices(conversation.id),
    loadBlobs(conversation.id, deviceId),
    loadSealedGroup(userId, conversation.id),
  ]);
  const existing = sealed ? await openGroupRecord(key, userId, conversation.id, sealed) : null;
  const result = await syncGroup({
    record: existing,
    userId,
    deviceId,
    role,
    conversationId: conversation.id,
    signingPrivateJwk: signing.privateJwk,
    signingPublicKey: signing.publicKey,
    memberUserIds: conversation.memberUserIds ?? [userId],
    directory: devices.devices.map((device) => ({
      userId: device.userId,
      deviceId: device.deviceId,
      signingPublicKey: b64ToBytes(device.signingPublicKey),
      role: device.role,
    })),
    blobs,
    post: (body) => api.postGroupMls(conversation.id, { ...body, senderDeviceId: deviceId }),
  });
  await saveSealedGroup(
    userId,
    conversation.id,
    await sealGroupRecord(key, userId, conversation.id, result.record),
  );
  for (const message of result.messages) {
    const sender = devices.devices.find((device) => device.deviceId === message.senderDeviceId);
    await saveLocalMessage(localFrom(conversation.id, message, deviceId, sender?.userId));
  }
  const messages = await listLocalMessages(conversation.id, 100);
  const selfRemoved = result.selfRemoved;
  return {
    messages,
    joined: Boolean(result.record.session) && !selfRemoved,
    status: selfRemoved
      ? "group.left"
      : result.record.session
        ? "group.membersOnly"
        : "group.waitingAdmin",
    error: result.error,
    selfRemoved,
  };
}

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

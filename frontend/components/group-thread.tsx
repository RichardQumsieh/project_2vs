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
  return (
    <div className="grid h-full place-items-center p-8 text-center text-sm text-white/70">
      Group encryption is turned off in this app. Turn on both group flags to open this conversation.
    </div>
  );
}

export function NewGroupForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [usernames, setUsernames] = useState("");
  const [error, setError] = useState<string | null>(null);
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
      setError(cause instanceof Error ? cause.message : "Could not create the group.");
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
      <p className="text-xs font-medium text-white/70">New encrypted group</p>
      <Input
        aria-label="Group name"
        placeholder="Group name"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={80}
      />
      <Input
        aria-label="Group member usernames"
        placeholder="Usernames, separated by spaces"
        value={usernames}
        onChange={(event) => setUsernames(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={create.isPending}>
        {create.isPending ? "Creating…" : "Create group"}
      </Button>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </form>
  );
}

export function GroupThread({ conversation }: { conversation: Conversation }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [username, setUsername] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
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
  const status = sync.data?.status ?? (sync.isLoading ? "Opening the group…" : null);
  const error = actionError ?? sync.data?.error ?? (sync.error instanceof Error ? sync.error.message : null);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !userId) return;
    setActionError(null);
    try {
      const key = requireVault();
      const sealed = await loadSealedGroup(userId, conversation.id);
      if (!sealed) throw new Error("This device has not joined the group yet.");
      const record = await openGroupRecord(key, userId, conversation.id, sealed);
      const queued = await queueGroupMessage(record, text);
      await saveSealedGroup(userId, conversation.id, await sealGroupRecord(key, userId, conversation.id, queued));
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not send the message.");
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
      setActionError(cause instanceof Error ? cause.message : "Could not add that member.");
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
      setActionError(cause instanceof Error ? cause.message : "Could not remove that member.");
    }
  }

  async function leaveGroup() {
    if (!userId) return;
    const others = (conversation.members ?? []).filter((member) => member.userId !== userId);
    const admins = (conversation.members ?? []).filter((member) => member.role === "ADMIN");
    if (admins.length === 1 && admins[0]?.userId === userId && others.length > 0) {
      setActionError("The last admin cannot leave while other members remain.");
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
      setActionError("Leave is waiting for an admin to commit the new group keys.");
      await queryClient.invalidateQueries({ queryKey: ["group-sync", conversation.id] });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not leave the group.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{conversation.title?.trim() || "Encrypted group"}</h1>
          <p className="truncate text-xs text-white/45">
            End-to-end encrypted · {(conversation.members ?? []).length} members
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void leaveGroup()}>
          Leave
        </Button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <p className="text-sm text-white/45">
                {joined ? "No messages yet." : status}
              </p>
            ) : messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-[36rem] rounded-2xl px-3 py-2 text-sm ${
                  message.fromMe ? "ml-auto bg-cyan-300/15" : "bg-white/[0.04]"
                }`}
              >
                <p className="mb-1 text-[11px] text-white/40">
                  {message.fromMe ? "You" : memberLabel(conversation, message)}
                </p>
                <p className="whitespace-pre-wrap break-words">{message.plaintext}</p>
              </article>
            ))}
          </div>
          <form className="flex gap-2 border-t border-white/10 p-3" onSubmit={(event) => void sendMessage(event)}>
            <Input
              aria-label="Group message"
              placeholder={joined ? "Message the group" : "Waiting to join"}
              value={draft}
              disabled={!joined}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={16000}
            />
            <Button type="submit" size="sm" disabled={!joined || draft.trim().length === 0}>
              Send
            </Button>
          </form>
        </div>
        <aside className="border-t border-white/10 p-4 md:border-t-0 md:border-l">
          <h2 className="text-xs font-medium uppercase tracking-wide text-white/45">Members</h2>
          <ul className="mt-3 space-y-2">
            {(conversation.members ?? []).map((member) => (
              <li key={member.userId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{member.displayName?.trim() || member.username}</span>
                  <span className="block truncate text-xs text-white/40">
                    @{member.username} · {member.role === "ADMIN" ? "Admin" : "Member"}
                  </span>
                </span>
                {isAdmin && member.userId !== userId ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void removeMember(member.userId)}>
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {isAdmin ? (
            <form className="mt-4 space-y-2" onSubmit={(event) => void addMember(event)}>
              <Input
                aria-label="Username to add"
                placeholder="Username to add"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <Button type="submit" size="sm" variant="outline">Add member</Button>
            </form>
          ) : null}
          {status && joined ? <p className="mt-3 text-xs text-white/45">{status}</p> : null}
          {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        </aside>
      </div>
    </div>
  );
}

function memberLabel(conversation: Conversation, message: LocalMessage) {
  const member = conversation.members?.find((item) => item.userId === message.senderUserId);
  return member?.displayName?.trim() || (member ? `@${member.username}` : "Member");
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
  status: string | null;
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
      status: "Unlock this device to use the group.",
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
      ? "You left this group. Later messages cannot be decrypted here."
      : result.record.session
        ? "Only members can read this conversation."
        : "Waiting for an admin to add this device.",
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

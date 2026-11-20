import { b64ToBytes, bytesToB64 } from "./crypto/bytes";
import {
  addDevice,
  applyCommit,
  applyProposal,
  commitPending,
  createGroupDevice,
  createGroupSession,
  GroupCryptoError,
  hasPendingProposals,
  joinFromWelcome,
  listMembers,
  listRoster,
  openMessage,
  proposeSelfRemoval,
  publishedKeyPackage,
  removeDevice,
  sealMessage,
  trustKeyPackage,
  type GroupRole,
} from "./crypto/group-mls";
import type { GroupOutboxItem, GroupRecord } from "./crypto/group-store";

export type GroupWireBlob = {
  id: string;
  kind: GroupOutboxItem["kind"];
  senderDeviceId: string;
  recipientDeviceId: string | null;
  payload: string;
  bindingSignature: string | null;
  createdAt: string;
};

export type DirectoryDevice = {
  userId: string;
  deviceId: string;
  signingPublicKey: Uint8Array;
  role: GroupRole;
};

export type GroupSyncMessage = {
  id: string;
  senderDeviceId: string;
  plaintext: string;
  createdAt: string;
};

export type GroupPost = {
  clientId: string;
  kind: GroupOutboxItem["kind"];
  payload: string;
  recipientDeviceId?: string;
  bindingSignature?: string;
};

export async function syncGroup(input: {
  record: GroupRecord | null;
  userId: string;
  deviceId: string;
  role: GroupRole;
  conversationId: string;
  signingPrivateJwk: JsonWebKey;
  signingPublicKey: Uint8Array;
  memberUserIds: readonly string[];
  directory: readonly DirectoryDevice[];
  blobs: readonly GroupWireBlob[];
  post: (body: GroupPost) => Promise<{ id: string }>;
}): Promise<{
  record: GroupRecord;
  messages: GroupSyncMessage[];
  selfRemoved: boolean;
  error: string | null;
}> {
  let record = input.record;
  if (!record) {
    const device = await createGroupDevice({
      userId: input.userId,
      deviceId: input.deviceId,
      role: input.role,
      sophiaSigningPrivateJwk: input.signingPrivateJwk,
      sophiaSigningPublicKey: input.signingPublicKey,
    });
    const session = input.role === "admin"
      ? await createGroupSession(device, input.conversationId)
      : null;
    const published = publishedKeyPackage(device);
    record = {
      device,
      session,
      appliedBlobIds: [],
      keyPackages: [published],
      outbox: [{
        clientId: crypto.randomUUID(),
        kind: "key_package",
        payload: device.keyPackageWire,
        bindingSignature: device.bindingSignature,
      }],
    };
  }

  const flushed = await flushOutbox(record, input.post);
  record = flushed.record;
  if (flushed.error) {
    return { record, messages: [], selfRemoved: isRemoved(record), error: flushed.error };
  }

  let messages: GroupSyncMessage[] = [];
  try {
    const ingested = await ingestBlobs(record, input);
    record = ingested.record;
    messages = ingested.messages;
  } catch (error) {
    return {
      record,
      messages,
      selfRemoved: isRemoved(record),
      error: error instanceof Error ? error.message : "Could not apply a group update",
    };
  }

  try {
    record = await administer(record, input.directory);
  } catch (error) {
    return {
      record,
      messages,
      selfRemoved: isRemoved(record),
      error: error instanceof Error ? error.message : "Could not update group membership",
    };
  }

  const posted = await flushOutbox(record, input.post);
  record = posted.record;
  const ownMessages = posted.delivered.flatMap((item) =>
    item.plaintext !== undefined
      ? [{
          id: item.serverId,
          senderDeviceId: record.device.ref.deviceId,
          plaintext: item.plaintext,
          createdAt: item.createdAt,
        }]
      : [],
  );
  return {
    record,
    messages: [...messages, ...ownMessages],
    selfRemoved: isRemoved(record),
    error: posted.error,
  };
}

export async function queueGroupMessage(record: GroupRecord, plaintext: string): Promise<GroupRecord> {
  if (!record.session) {
    throw new GroupCryptoError("This device has not joined the group yet", "not_member");
  }
  const sealed = await sealMessage(record.session, plaintext);
  return {
    ...record,
    session: sealed.session,
    outbox: [...record.outbox, {
      clientId: crypto.randomUUID(),
      kind: "application",
      payload: sealed.message,
      plaintext,
    }],
  };
}

export async function queueMemberRemoval(record: GroupRecord, deviceId: string): Promise<GroupRecord> {
  if (!record.session) {
    throw new GroupCryptoError("This device has not joined the group yet", "not_member");
  }
  const removed = await removeDevice(record.session, deviceId);
  return {
    ...record,
    session: removed.session,
    outbox: [...record.outbox, {
      clientId: crypto.randomUUID(),
      kind: "commit",
      payload: removed.commit,
    }],
  };
}

export async function queueSelfRemoval(record: GroupRecord): Promise<GroupRecord> {
  if (!record.session) {
    throw new GroupCryptoError("This device has not joined the group yet", "not_member");
  }
  const proposed = await proposeSelfRemoval(record.session);
  return {
    ...record,
    session: proposed.session,
    outbox: [...record.outbox, {
      clientId: crypto.randomUUID(),
      kind: "proposal",
      payload: proposed.proposal,
    }],
  };
}

function isRemoved(record: GroupRecord): boolean {
  return record.session?.state.groupActiveState.kind === "removedFromGroup";
}

async function flushOutbox(
  record: GroupRecord,
  post: (body: GroupPost) => Promise<{ id: string }>,
): Promise<{
  record: GroupRecord;
  delivered: Array<GroupOutboxItem & { serverId: string; createdAt: string }>;
  error: string | null;
}> {
  const applied = [...record.appliedBlobIds];
  const delivered: Array<GroupOutboxItem & { serverId: string; createdAt: string }> = [];
  const remaining: GroupOutboxItem[] = [];
  let error: string | null = null;
  for (let index = 0; index < record.outbox.length; index += 1) {
    const item = record.outbox[index]!;
    if (error) {
      remaining.push(item);
      continue;
    }
    try {
      const posted = await post({
        clientId: item.clientId,
        kind: item.kind,
        payload: bytesToB64(item.payload),
        ...(item.recipientDeviceId ? { recipientDeviceId: item.recipientDeviceId } : {}),
        ...(item.bindingSignature ? { bindingSignature: bytesToB64(item.bindingSignature) } : {}),
      });
      applied.push(posted.id);
      delivered.push({ ...item, serverId: posted.id, createdAt: new Date().toISOString() });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Could not upload a group update";
      remaining.push(item);
    }
  }
  return { record: { ...record, appliedBlobIds: applied, outbox: remaining }, delivered, error };
}

async function ingestBlobs(
  record: GroupRecord,
  input: {
    directory: readonly DirectoryDevice[];
    blobs: readonly GroupWireBlob[];
    memberUserIds: readonly string[];
  },
): Promise<{ record: GroupRecord; messages: GroupSyncMessage[] }> {
  const applied = new Set(record.appliedBlobIds);
  const messages: GroupSyncMessage[] = [];
  const ordered = [...input.blobs].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt),
  );
  let next = record;
  const beforeJoin: string[] = [];
  for (const blob of ordered) {
    if (applied.has(blob.id)) continue;
    const welcomeForMe = blob.kind === "welcome" && blob.recipientDeviceId === next.device.ref.deviceId;
    if (!next.session && blob.kind !== "key_package" && !welcomeForMe) {
      beforeJoin.push(blob.id);
      continue;
    }
    next = await ingestOne(next, blob, input.directory, input.memberUserIds, messages);
    applied.add(blob.id);
    if (next.session && beforeJoin.length > 0) {
      for (const id of beforeJoin) applied.add(id);
      beforeJoin.length = 0;
    }
    next = { ...next, appliedBlobIds: [...applied] };
  }
  return { record: next, messages };
}

async function ingestOne(
  record: GroupRecord,
  blob: GroupWireBlob,
  directory: readonly DirectoryDevice[],
  memberUserIds: readonly string[],
  messages: GroupSyncMessage[],
): Promise<GroupRecord> {
  const mine = blob.senderDeviceId === record.device.ref.deviceId;
  if (blob.kind === "key_package") {
    return rememberKeyPackage(record, blob, directory);
  }
  if (blob.kind === "welcome") {
    if (blob.recipientDeviceId !== record.device.ref.deviceId || record.session) return record;
    const joined = await joinFromWelcome(record.device, b64ToBytes(blob.payload));
    const allowed = new Set(memberUserIds.map((userId) => userId.toLowerCase()));
    if (listMembers(joined).some((member) => !allowed.has(member.userId))) {
      throw new GroupCryptoError("Welcome includes a user who is not in the group", "rejected");
    }
    let session = joined;
    for (const published of record.keyPackages) {
      const device = directory.find((entry) => entry.deviceId === published.deviceId);
      if (!device) continue;
      try {
        session = await trustKeyPackage(session, published, device.signingPublicKey);
      } catch {
        // An unbound package stays untrusted and cannot be added later.
      }
    }
    return { ...record, session };
  }
  if (!record.session) return record;
  if (mine && (blob.kind === "proposal" || blob.kind === "commit" || blob.kind === "application")) {
    return record;
  }
  if (record.session.state.groupActiveState.kind === "removedFromGroup") return record;
  if (blob.kind === "proposal") {
    return { ...record, session: await applyProposal(record.session, b64ToBytes(blob.payload)) };
  }
  if (blob.kind === "commit") {
    const applied = await applyCommit(record.session, b64ToBytes(blob.payload));
    return { ...record, session: applied.session };
  }
  if (blob.kind === "application") {
    const opened = await openMessage(record.session, b64ToBytes(blob.payload));
    messages.push({
      id: blob.id,
      senderDeviceId: blob.senderDeviceId,
      plaintext: opened.plaintext,
      createdAt: blob.createdAt,
    });
    return { ...record, session: opened.session };
  }
  return record;
}

function rememberKeyPackage(
  record: GroupRecord,
  blob: GroupWireBlob,
  directory: readonly DirectoryDevice[],
): Promise<GroupRecord> {
  const sender = directory.find((device) => device.deviceId === blob.senderDeviceId);
  if (!sender || !blob.bindingSignature) return Promise.resolve(record);
  const published = {
    userId: sender.userId,
    deviceId: sender.deviceId,
    keyPackageB64: blob.payload,
    bindingSignatureB64: blob.bindingSignature,
  };
  const keyPackages = [
    ...record.keyPackages.filter((item) => item.deviceId !== sender.deviceId),
    published,
  ];
  if (!record.session || sender.deviceId === record.device.ref.deviceId) {
    return Promise.resolve({ ...record, keyPackages });
  }
  return trustKeyPackage(record.session, published, sender.signingPublicKey)
    .then((session) => ({ ...record, session, keyPackages }))
    .catch(() => ({ ...record, keyPackages }));
}

async function administer(
  record: GroupRecord,
  directory: readonly DirectoryDevice[],
): Promise<GroupRecord> {
  let next = record;
  for (let step = 0; step < 8; step += 1) {
    if (!next.session || isRemoved(next)) return next;
    const self = listRoster(next.session).find((leaf) => leaf.deviceId === next.device.ref.deviceId);
    if (!self || self.role !== "admin") return next;
    if (hasPendingProposals(next.session)) {
      try {
        const committed = await commitPending(next.session);
        next = {
          ...next,
          session: committed.session,
          outbox: [...next.outbox, {
            clientId: crypto.randomUUID(),
            kind: "commit",
            payload: committed.commit,
          }],
        };
        continue;
      } catch (error) {
        if (error instanceof GroupCryptoError && error.message.includes("own removal")) return next;
        throw error;
      }
    }
    const welcomed = await welcomeNext(next, directory);
    if (!welcomed) return next;
    next = welcomed;
  }
  return next;
}

async function welcomeNext(
  record: GroupRecord,
  directory: readonly DirectoryDevice[],
): Promise<GroupRecord | null> {
  if (!record.session) return null;
  const present = new Set(listMembers(record.session).map((member) => member.deviceId));
  for (const device of directory) {
    if (present.has(device.deviceId)) continue;
    const published = record.keyPackages.find((item) => item.deviceId === device.deviceId);
    if (!published) continue;
    try {
      const added = await addDevice(record.session, published, device.signingPublicKey);
      return {
        ...record,
        session: added.session,
        outbox: [
          ...record.outbox,
          { clientId: crypto.randomUUID(), kind: "commit", payload: added.commit },
          {
            clientId: crypto.randomUUID(),
            kind: "welcome",
            payload: added.welcome,
            recipientDeviceId: device.deviceId,
          },
        ],
      };
    } catch (error) {
      if (error instanceof GroupCryptoError) continue;
      throw error;
    }
  }
  return null;
}

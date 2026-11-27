import { b64ToBytes, bytesToB64, equalBytes } from "./crypto/bytes";
import {
  addDevice,
  applyCommit,
  applyProposal,
  commitPending,
  createGroupDevice,
  createGroupSession,
  encodeSessionState,
  GroupCryptoError,
  hasPendingProposals,
  joinFromWelcome,
  listMembers,
  listRoster,
  openMessage,
  ownLeafPublicKey,
  proposeRoleUpdate,
  proposeSelfRemoval,
  publishedKeyPackage,
  removeDevice,
  sealMessage,
  sessionFromEncodedState,
  trustKeyPackage,
  withLeafPrivateKey,
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

  const first = await runSyncPass(record, input);
  record = first.record;
  if (!first.conflict) {
    return {
      record,
      messages: first.messages,
      selfRemoved: isRemoved(record),
      error: first.error,
    };
  }

  let carried = first.messages;
  try {
    const ingested = await ingestBlobs(record, input);
    record = ingested.record;
    carried = [...first.messages, ...ingested.messages];
    for (const item of first.reverted) {
      if (
        item.removeDeviceId &&
        record.session &&
        listMembers(record.session).some((member) => member.deviceId === item.removeDeviceId)
      ) {
        record = await queueMemberRemoval(record, item.removeDeviceId);
      }
    }
    record = await publishRoleUpdate(record, input.directory);
    record = await administer(record, input.directory);
  } catch (error) {
    return {
      record,
      messages: [],
      selfRemoved: isRemoved(record),
      error: error instanceof Error ? error.message : "Could not recover the group fork",
    };
  }
  const retried = await flushOutbox(record, input.post);
  record = retried.record;
  if (retried.stalePlaintext.length > 0) {
    for (const plaintext of retried.stalePlaintext) {
      record = await queueGroupMessage(record, plaintext);
    }
  }
  if (retried.conflict || retried.stalePlaintext.length > 0) {
    return {
      record,
      messages: carried,
      selfRemoved: isRemoved(record),
      error: "Another member committed first. Sync again to retry.",
    };
  }
  return {
    record,
    messages: [...carried, ...messagesFrom(record, retried.delivered)],
    selfRemoved: isRemoved(record),
    error: retried.error,
  };
}

/**
 * Reload MLS blobs only after an epoch race. Do not key off leftover outbox
 * items — that doubled every poll while administer/commit work was pending and
 * tripped the API rate limit (429), while discarding messages from the first pass.
 */
export function shouldReloadGroupBlobs(result: {
  error: string | null;
  record: GroupRecord;
}): boolean {
  if (!result.error) return false;
  return (
    /MLS epoch/i.test(result.error) ||
    /committed first/i.test(result.error) ||
    /Sync again/i.test(result.error)
  );
}

async function runSyncPass(
  record: GroupRecord,
  input: {
    directory: readonly DirectoryDevice[];
    blobs: readonly GroupWireBlob[];
    memberUserIds: readonly string[];
    post: (body: GroupPost) => Promise<{ id: string }>;
  },
): Promise<{
  record: GroupRecord;
  messages: GroupSyncMessage[];
  error: string | null;
  conflict: boolean;
  reverted: GroupOutboxItem[];
}> {
  // Flush protocol/outbox first so concurrent commits can resolve via conflict
  // recovery. Application ciphertext that fails with mls_epoch_order is resealed
  // after ingesting the commits that advanced the epoch.
  const flushed = await flushOutbox(record, input.post);
  record = flushed.record;
  if (flushed.conflict) {
    return { record, messages: [], error: null, conflict: true, reverted: flushed.reverted };
  }
  if (flushed.error) {
    return { record, messages: [], error: flushed.error, conflict: false, reverted: [] };
  }

  let messages: GroupSyncMessage[] = [];
  try {
    const ingested = await ingestBlobs(record, input);
    record = ingested.record;
    messages = ingested.messages;
    for (const plaintext of flushed.stalePlaintext) {
      record = await queueGroupMessage(record, plaintext);
    }
    record = await resealPendingApplications(record);
  } catch (error) {
    return {
      record,
      messages,
      error: error instanceof Error ? error.message : "Could not apply a group update",
      conflict: false,
      reverted: [],
    };
  }

  try {
    record = await publishRoleUpdate(record, input.directory);
    record = await administer(record, input.directory);
  } catch (error) {
    return {
      record,
      messages,
      error: error instanceof Error ? error.message : "Could not update group membership",
      conflict: false,
      reverted: [],
    };
  }

  const posted = await flushOutbox(record, input.post);
  record = posted.record;
  if (posted.conflict) {
    return { record, messages, error: null, conflict: true, reverted: posted.reverted };
  }
  if (posted.stalePlaintext.length > 0) {
    for (const plaintext of posted.stalePlaintext) {
      record = await queueGroupMessage(record, plaintext);
    }
    return { record, messages, error: null, conflict: true, reverted: [] };
  }
  return {
    record,
    messages: [...messages, ...messagesFrom(record, posted.delivered)],
    error: posted.error,
    conflict: false,
    reverted: [],
  };
}

async function resealPendingApplications(record: GroupRecord): Promise<GroupRecord> {
  if (!record.session) return record;
  const kept: GroupOutboxItem[] = [];
  const plaintexts: string[] = [];
  for (const item of record.outbox) {
    if (item.kind === "application" && item.plaintext !== undefined) {
      plaintexts.push(item.plaintext);
    } else {
      kept.push(item);
    }
  }
  if (plaintexts.length === 0) return record;
  let next: GroupRecord = { ...record, outbox: kept };
  for (const plaintext of plaintexts) {
    next = await queueGroupMessage(next, plaintext);
  }
  return next;
}

function messagesFrom(
  record: GroupRecord,
  delivered: Array<GroupOutboxItem & { serverId: string; createdAt: string }>,
): GroupSyncMessage[] {
  return delivered.flatMap((item) =>
    item.plaintext !== undefined
      ? [{
          id: item.serverId,
          senderDeviceId: record.device.ref.deviceId,
          plaintext: item.plaintext,
          createdAt: item.createdAt,
        }]
      : [],
  );
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
  const priorState = encodeSessionState(record.session);
  const removed = await removeDevice(record.session, deviceId);
  return {
    ...record,
    session: removed.session,
    outbox: [...record.outbox, {
      clientId: crypto.randomUUID(),
      kind: "commit",
      payload: removed.commit,
      priorState,
      batchId: crypto.randomUUID(),
      removeDeviceId: deviceId.toLowerCase(),
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

function deliveryCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

async function flushOutbox(
  record: GroupRecord,
  post: (body: GroupPost) => Promise<{ id: string }>,
): Promise<{
  record: GroupRecord;
  delivered: Array<GroupOutboxItem & { serverId: string; createdAt: string }>;
  error: string | null;
  conflict: boolean;
  reverted: GroupOutboxItem[];
  stalePlaintext: string[];
}> {
  const applied = [...record.appliedBlobIds];
  const delivered: Array<GroupOutboxItem & { serverId: string; createdAt: string }> = [];
  const remaining: GroupOutboxItem[] = [];
  const reverted: GroupOutboxItem[] = [];
  const stalePlaintext: string[] = [];
  let error: string | null = null;
  let conflict = false;
  let conflictBatch: string | null = null;
  let session = record.session;
  for (let index = 0; index < record.outbox.length; index += 1) {
    const item = record.outbox[index]!;
    if (conflict && item.batchId && item.batchId === conflictBatch) {
      reverted.push(item);
      continue;
    }
    if (error || conflict) {
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
      const code = deliveryCode(cause);
      // Behind or raced on this epoch: restore pre-commit state and let sync
      // ingest the winner, then retry membership work from reverted items.
      if (
        item.kind === "commit" &&
        (code === "mls_epoch_conflict" || code === "mls_epoch_order") &&
        item.priorState &&
        session
      ) {
        session = sessionFromEncodedState(record.device, item.priorState, [...session.trustedKeyPackages]);
        conflict = true;
        conflictBatch = item.batchId ?? item.clientId;
        reverted.push(item);
        continue;
      }
      if (item.kind === "proposal" && code === "mls_epoch_order") {
        conflict = true;
        continue;
      }
      if (item.kind === "application" && item.plaintext && code === "mls_epoch_order") {
        stalePlaintext.push(item.plaintext);
        continue;
      }
      error = cause instanceof Error ? cause.message : "Could not upload a group update";
      remaining.push(item);
    }
  }
  return {
    record: { ...record, session, appliedBlobIds: applied, outbox: remaining },
    delivered,
    error,
    conflict,
    reverted,
    stalePlaintext,
  };
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
    const wire = b64ToBytes(blob.payload);
    let applied;
    try {
      applied = await applyCommit(record.session, wire);
    } catch (error) {
      if (!record.pendingLeaf) throw error;
      try {
        applied = await applyCommit(
          withLeafPrivateKey(record.session, b64ToBytes(record.pendingLeaf.privateKey)),
          wire,
        );
      } catch {
        throw error;
      }
    }
    let session = applied.session;
    let pendingLeaf = record.pendingLeaf;
    if (pendingLeaf && equalBytes(ownLeafPublicKey(session), b64ToBytes(pendingLeaf.publicKey))) {
      session = withLeafPrivateKey(session, b64ToBytes(pendingLeaf.privateKey));
      pendingLeaf = undefined;
    }
    const rosterRole = listRoster(session).find((leaf) => leaf.deviceId === record.device.ref.deviceId)?.role;
    return {
      ...record,
      session,
      pendingLeaf,
      device: rosterRole ? { ...record.device, role: rosterRole } : record.device,
    };
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

function directoryRoles(directory: readonly DirectoryDevice[]): Map<string, GroupRole> {
  return new Map(directory.map((device) => [device.deviceId.toLowerCase(), device.role]));
}

function directoryRole(record: GroupRecord, directory: readonly DirectoryDevice[]): GroupRole | null {
  return directory.find((device) => device.deviceId === record.device.ref.deviceId)?.role ?? null;
}

async function publishRoleUpdate(
  record: GroupRecord,
  directory: readonly DirectoryDevice[],
): Promise<GroupRecord> {
  if (!record.session || isRemoved(record) || record.pendingLeaf) return record;
  const self = listRoster(record.session).find((leaf) => leaf.deviceId === record.device.ref.deviceId);
  const desired = directoryRole(record, directory);
  if (!self || !desired || self.role === desired) return record;
  const already = Object.values(record.session.state.unappliedProposals).some((entry) => {
    if (entry.proposal.proposalType !== "update") return false;
    if (entry.senderLeafIndex !== record.session?.state.privatePath.leafIndex) return false;
    return true;
  });
  if (already) return record;
  const proposed = await proposeRoleUpdate(record.session, desired);
  return {
    ...record,
    session: proposed.session,
    pendingLeaf: {
      publicKey: bytesToB64(proposed.leafPublicKey),
      privateKey: bytesToB64(proposed.leafPrivateKey),
    },
    outbox: [...record.outbox, {
      clientId: crypto.randomUUID(),
      kind: "proposal",
      payload: proposed.proposal,
    }],
  };
}

async function administer(
  record: GroupRecord,
  directory: readonly DirectoryDevice[],
): Promise<GroupRecord> {
  let next = record;
  for (let step = 0; step < 8; step += 1) {
    if (!next.session || isRemoved(next)) return next;
    const self = listRoster(next.session).find((leaf) => leaf.deviceId === next.device.ref.deviceId);
    const allowedAdmin = self?.role === "admin" && directoryRole(next, directory) === "admin";
    if (!allowedAdmin) {
      if (!hasPendingProposals(next.session)) return next;
      try {
        const priorState = encodeSessionState(next.session);
        const committed = await commitPending(next.session, { selfRemovalsOnly: true });
        const batchId = crypto.randomUUID();
        next = {
          ...next,
          session: committed.session,
          outbox: [...next.outbox, {
            clientId: crypto.randomUUID(),
            kind: "commit",
            payload: committed.commit,
            priorState,
            batchId,
          }],
        };
        continue;
      } catch (error) {
        if (error instanceof GroupCryptoError && (
          error.message.includes("own removal") ||
          error.message.includes("no pending")
        )) return next;
        throw error;
      }
    }
    if (hasPendingProposals(next.session)) {
      try {
        const priorState = encodeSessionState(next.session);
        const committed = await commitPending(next.session, { directoryRoles: directoryRoles(directory) });
        const batchId = crypto.randomUUID();
        next = {
          ...next,
          session: committed.session,
          outbox: [
            ...next.outbox,
            {
              clientId: crypto.randomUUID(),
              kind: "commit",
              payload: committed.commit,
              priorState,
              batchId,
            },
            ...(committed.welcome
              ? [{
                  clientId: crypto.randomUUID(),
                  kind: "welcome" as const,
                  payload: committed.welcome,
                  batchId,
                }]
              : []),
          ],
        };
        continue;
      } catch (error) {
        if (error instanceof GroupCryptoError && (
          error.message.includes("own removal") ||
          error.message.includes("no pending")
        )) {
          const welcomed = await welcomeNext(next, directory);
          return welcomed ?? next;
        }
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
      const priorState = encodeSessionState(record.session);
      const added = await addDevice(record.session, published, device.signingPublicKey);
      const batchId = crypto.randomUUID();
      return {
        ...record,
        session: added.session,
        outbox: [
          ...record.outbox,
          { clientId: crypto.randomUUID(), kind: "commit", payload: added.commit, priorState, batchId },
          {
            clientId: crypto.randomUUID(),
            kind: "welcome",
            payload: added.welcome,
            recipientDeviceId: device.deviceId,
            batchId,
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

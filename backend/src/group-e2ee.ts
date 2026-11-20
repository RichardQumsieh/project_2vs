import { verifyEd25519 } from "./ed25519.js";
import { readPublicMlsHeader, type MlsContentType } from "./mls-framing.js";

export const GROUP_E2EE_MAX_USERS = 8;
export const GROUP_MLS_BLOB_MAX_BYTES = 256 * 1024;

export const groupMlsBlobKinds = ["key_package", "welcome", "commit", "proposal", "application"] as const;
export type GroupMlsBlobKind = (typeof groupMlsBlobKinds)[number];

export type GroupGateFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 503;
  error: string;
  code?: string;
};

export type GroupGateSuccess<T> = { ok: true } & T;

export function gateGroupE2ee(enabled: boolean): GroupGateSuccess<Record<never, never>> | GroupGateFailure {
  if (!enabled) {
    return {
      ok: false,
      status: 503,
      error: "Group E2EE is disabled on this server",
      code: "group_e2ee_disabled",
    };
  }
  return { ok: true };
}

export type GroupMemberRef = {
  userId: string;
  role: "ADMIN" | "MEMBER";
};

export function planGroupMembers(
  creatorUserId: string,
  requestedUserIds: readonly string[],
): GroupGateSuccess<{ members: GroupMemberRef[] }> | GroupGateFailure {
  if (new Set(requestedUserIds).size !== requestedUserIds.length) {
    return { ok: false, status: 400, error: "Duplicate group members" };
  }
  const others = requestedUserIds.filter((userId) => userId !== creatorUserId);
  const members: GroupMemberRef[] = [
    { userId: creatorUserId, role: "ADMIN" },
    ...others.map((userId) => ({ userId, role: "MEMBER" as const })),
  ];
  if (members.length > GROUP_E2EE_MAX_USERS) {
    return { ok: false, status: 400, error: "Groups are limited to 8 members" };
  }
  return { ok: true, members };
}

export function planMembershipChange(
  members: readonly GroupMemberRef[],
  actorUserId: string,
  change: { op: "add"; userId: string; role?: "ADMIN" | "MEMBER" } | { op: "remove"; userId: string },
): GroupGateSuccess<{ members: GroupMemberRef[] }> | GroupGateFailure {
  const actor = members.find((member) => member.userId === actorUserId);
  if (!actor) {
    return { ok: false, status: 404, error: "Conversation not found" };
  }
  if (change.op === "add") {
    if (actor.role !== "ADMIN") {
      return { ok: false, status: 403, error: "Only a group admin can add members" };
    }
    if (members.some((member) => member.userId === change.userId)) {
      return { ok: false, status: 409, error: "User is already a member" };
    }
    if (members.length + 1 > GROUP_E2EE_MAX_USERS) {
      return { ok: false, status: 400, error: "Groups are limited to 8 members" };
    }
    return {
      ok: true,
      members: [...members, { userId: change.userId, role: change.role ?? "MEMBER" }],
    };
  }
  if (!members.some((member) => member.userId === change.userId)) {
    return { ok: false, status: 404, error: "Member not found" };
  }
  if (actorUserId !== change.userId && actor.role !== "ADMIN") {
    return { ok: false, status: 403, error: "Only a group admin can remove members" };
  }
  const admins = members.filter((member) => member.role === "ADMIN");
  const removingLastAdmin = admins.length === 1 && admins[0]?.userId === change.userId && members.length > 1;
  if (removingLastAdmin) {
    return {
      ok: false,
      status: 409,
      error: "The last admin cannot leave while other members remain",
    };
  }
  return { ok: true, members: members.filter((member) => member.userId !== change.userId) };
}

export function planRoleChange(
  members: readonly GroupMemberRef[],
  actorUserId: string,
  userId: string,
  role: "ADMIN" | "MEMBER",
): GroupGateSuccess<{ members: GroupMemberRef[] }> | GroupGateFailure {
  const actor = members.find((member) => member.userId === actorUserId);
  if (!actor) {
    return { ok: false, status: 404, error: "Conversation not found" };
  }
  if (actor.role !== "ADMIN") {
    return { ok: false, status: 403, error: "Only a group admin can change roles" };
  }
  const target = members.find((member) => member.userId === userId);
  if (!target) {
    return { ok: false, status: 404, error: "Member not found" };
  }
  if (target.role === role) {
    return { ok: true, members: members.map((member) => ({ ...member })) };
  }
  const admins = members.filter((member) => member.role === "ADMIN");
  const demotingLastAdmin =
    role === "MEMBER" && admins.length === 1 && admins[0]?.userId === userId && members.length > 1;
  if (demotingLastAdmin) {
    return {
      ok: false,
      status: 409,
      error: "The last admin cannot leave while other members remain",
      code: "last_admin",
    };
  }
  return {
    ok: true,
    members: members.map((member) => (member.userId === userId ? { ...member, role } : { ...member })),
  };
}

export type GroupUnreadBlob = {
  id: string;
  conversationId: string;
  kind: string;
  createdAt: string;
  senderUserId: string;
};

/**
 * Unread application blobs for one member. Ordering is (createdAt, id).
 * The cursor blob itself is already read. Own sends are not unread.
 */
export function countUnreadGroupApplications(input: {
  blobs: readonly GroupUnreadBlob[];
  conversationId: string;
  viewerUserId: string;
  readThrough: { createdAt: string; id: string } | null;
}): number {
  return input.blobs.filter((blob) => {
    if (blob.conversationId !== input.conversationId || blob.kind !== "application") return false;
    if (blob.senderUserId === input.viewerUserId) return false;
    if (!input.readThrough) return true;
    if (blob.createdAt > input.readThrough.createdAt) return true;
    if (blob.createdAt < input.readThrough.createdAt) return false;
    return blob.id > input.readThrough.id;
  }).length;
}

/** Non-members get the same 404 as a missing conversation. */
export function groupAccess(
  members: readonly string[],
  userId: string,
): GroupGateSuccess<Record<never, never>> | GroupGateFailure {
  if (!members.includes(userId)) {
    return { ok: false, status: 404, error: "Conversation not found" };
  }
  return { ok: true };
}

export function canReadGroupBlob(input: {
  kind: GroupMlsBlobKind;
  senderDeviceId: string;
  recipientDeviceId: string | null;
  viewerDeviceId: string;
  viewerIsMember: boolean;
}): boolean {
  if (!input.viewerIsMember) return false;
  if (input.kind !== "welcome") return true;
  return (
    input.recipientDeviceId === input.viewerDeviceId ||
    input.senderDeviceId === input.viewerDeviceId
  );
}

function decodeCanonicalBase64(value: string, maxBytes: number): Uint8Array | null {
  if (value.length === 0 || value.length > Math.ceil(maxBytes / 3) * 4 + 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
  if (bytes.toString("base64") !== value) return null;
  return new Uint8Array(bytes);
}

/**
 * Accept only opaque MLS bytes. Plaintext is not a field, and this function
 * never interprets the payload as text.
 */
export function validateGroupBlob(input: {
  kind: GroupMlsBlobKind;
  payload: string;
  recipientDeviceId?: string;
  bindingSignature?: string;
  senderDeviceId: string;
}): GroupGateSuccess<{
  payload: Uint8Array;
  bindingSignature: Uint8Array | null;
  recipientDeviceId: string | null;
}> | GroupGateFailure {
  const payload = decodeCanonicalBase64(input.payload, GROUP_MLS_BLOB_MAX_BYTES);
  if (!payload) {
    return { ok: false, status: 400, error: "Invalid MLS payload" };
  }
  if (input.kind === "welcome") {
    if (!input.recipientDeviceId || input.recipientDeviceId === input.senderDeviceId) {
      return { ok: false, status: 400, error: "Welcome requires another member's device" };
    }
  } else if (input.recipientDeviceId) {
    return { ok: false, status: 400, error: "Only a Welcome is addressed to one device" };
  }
  if (input.kind === "key_package") {
    const bindingSignature = input.bindingSignature
      ? decodeCanonicalBase64(input.bindingSignature, 64)
      : null;
    if (!bindingSignature || bindingSignature.byteLength !== 64) {
      return {
        ok: false,
        status: 400,
        error: "Key package must be bound to the sender device",
      };
    }
    return {
      ok: true,
      payload,
      bindingSignature,
      recipientDeviceId: null,
    };
  }
  if (input.bindingSignature) {
    return { ok: false, status: 400, error: "Only a key package carries a device binding" };
  }
  return {
    ok: true,
    payload,
    bindingSignature: null,
    recipientDeviceId: input.kind === "welcome" ? input.recipientDeviceId ?? null : null,
  };
}

export function keyPackageBoundToDevice(input: {
  signingPublicKey: Uint8Array;
  payload: Uint8Array;
  bindingSignature: Uint8Array;
}): boolean {
  return verifyEd25519(input.signingPublicKey, input.payload, input.bindingSignature);
}

const contentTypeForKind: Partial<Record<GroupMlsBlobKind, MlsContentType>> = {
  application: "application",
  proposal: "proposal",
  commit: "commit",
};

export type AdmittedGroupBlob = {
  payload: Uint8Array;
  bindingSignature: Uint8Array | null;
  recipientDeviceId: string | null;
  epoch: number | null;
  nextEpoch: number;
  recordCommit: boolean;
};

/**
 * Validate opaque MLS bytes against the delivery cursor.
 * Rejects a malformed frame, a group id other than this conversation, an
 * epoch that is not the current one, and a second commit for the current epoch.
 * The ciphertext is not decrypted.
 */
export function admitGroupBlob(input: {
  kind: GroupMlsBlobKind;
  payload: string;
  recipientDeviceId?: string;
  bindingSignature?: string;
  senderDeviceId: string;
  conversationId: string;
  currentEpoch: number;
  commitRecordedForCurrentEpoch: boolean;
}): GroupGateSuccess<AdmittedGroupBlob> | GroupGateFailure {
  const stored = validateGroupBlob(input);
  if (!stored.ok) return stored;
  const header = readPublicMlsHeader(stored.payload);
  if (!header) {
    return { ok: false, status: 400, error: "Malformed MLS payload", code: "mls_malformed" };
  }
  const expected = contentTypeForKind[input.kind];
  if (expected) {
    if (header.shape !== "private" || header.contentType !== expected) {
      return { ok: false, status: 400, error: "Malformed MLS payload", code: "mls_malformed" };
    }
    const groupId = new TextEncoder().encode(input.conversationId);
    if (groupId.byteLength !== header.groupId.byteLength || !groupId.every((byte, index) => byte === header.groupId[index])) {
      return { ok: false, status: 400, error: "MLS group id does not match this conversation", code: "mls_malformed" };
    }
    if (header.epoch !== input.currentEpoch) {
      return {
        ok: false,
        status: 409,
        error: "MLS epoch is not the current group epoch",
        code: "mls_epoch_order",
      };
    }
    if (input.kind === "commit" && input.commitRecordedForCurrentEpoch) {
      return {
        ok: false,
        status: 409,
        error: "Another member already committed this epoch",
        code: "mls_epoch_conflict",
      };
    }
    return {
      ok: true,
      payload: stored.payload,
      bindingSignature: stored.bindingSignature,
      recipientDeviceId: stored.recipientDeviceId,
      epoch: header.epoch,
      nextEpoch: input.kind === "commit" ? input.currentEpoch + 1 : input.currentEpoch,
      recordCommit: input.kind === "commit",
    };
  }
  if (input.kind === "welcome" && header.shape !== "welcome") {
    return { ok: false, status: 400, error: "Malformed MLS payload", code: "mls_malformed" };
  }
  if (input.kind === "key_package" && header.shape !== "key_package") {
    return { ok: false, status: 400, error: "Malformed MLS payload", code: "mls_malformed" };
  }
  return {
    ok: true,
    payload: stored.payload,
    bindingSignature: stored.bindingSignature,
    recipientDeviceId: stored.recipientDeviceId,
    epoch: null,
    nextEpoch: input.currentEpoch,
    recordCommit: false,
  };
}

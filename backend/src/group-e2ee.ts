import { verifyEd25519 } from "./ed25519.js";

export const GROUP_E2EE_MAX_USERS = 8;
export const GROUP_MLS_BLOB_MAX_BYTES = 256 * 1024;

export const groupMlsBlobKinds = ["key_package", "welcome", "commit", "application"] as const;
export type GroupMlsBlobKind = (typeof groupMlsBlobKinds)[number];

export type GroupGateFailure = {
  ok: false;
  status: 400 | 404 | 409 | 503;
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

export function planGroupMembers(
  creatorUserId: string,
  requestedUserIds: readonly string[],
): GroupGateSuccess<{ memberUserIds: string[] }> | GroupGateFailure {
  if (new Set(requestedUserIds).size !== requestedUserIds.length) {
    return { ok: false, status: 400, error: "Duplicate group members" };
  }
  const memberUserIds = requestedUserIds.includes(creatorUserId)
    ? [...requestedUserIds]
    : [creatorUserId, ...requestedUserIds];
  if (memberUserIds.length > GROUP_E2EE_MAX_USERS) {
    return { ok: false, status: 400, error: "Groups are limited to 8 members" };
  }
  return { ok: true, memberUserIds };
}

export function planMembershipChange(
  members: readonly string[],
  change: { op: "add"; userId: string } | { op: "remove"; userId: string },
): GroupGateSuccess<{ memberUserIds: string[] }> | GroupGateFailure {
  if (change.op === "add") {
    if (members.includes(change.userId)) {
      return { ok: false, status: 409, error: "User is already a member" };
    }
    if (members.length + 1 > GROUP_E2EE_MAX_USERS) {
      return { ok: false, status: 400, error: "Groups are limited to 8 members" };
    }
    return { ok: true, memberUserIds: [...members, change.userId] };
  }
  if (!members.includes(change.userId)) {
    return { ok: false, status: 404, error: "Member not found" };
  }
  return { ok: true, memberUserIds: members.filter((userId) => userId !== change.userId) };
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

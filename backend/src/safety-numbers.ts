import { bytesToB64 } from "./util.js";

export const SAFETY_MAX_MEMBERS = 8;
export const SAFETY_MAX_DEVICES = 32;
export const SAFETY_DEVICE_QUERY_TAKE = SAFETY_MAX_MEMBERS * SAFETY_MAX_DEVICES + 1;

export type SafetyGateFailure = {
  ok: false;
  status: 503;
  error: string;
  code: "safety_numbers_disabled";
};

export function gateSafetyNumbers(enabled: boolean): { ok: true } | SafetyGateFailure {
  if (!enabled) {
    return {
      ok: false,
      status: 503,
      error: "Safety numbers are disabled on this server",
      code: "safety_numbers_disabled",
    };
  }
  return { ok: true };
}

export type SafetyDirectoryDevice = {
  id: string;
  userId: string;
  deviceName: string;
  identityPublicKey: Uint8Array;
  signingPublicKey: Uint8Array;
  revokedAt?: Date | null;
};

export type SafetyDirectoryMember = {
  userId: string;
  username: string;
  displayName: string | null;
  role: "ADMIN" | "MEMBER";
};

export type SafetyDirectoryFailure = {
  ok: false;
  status: 400 | 404;
  error: string;
};

export type SafetyIdentityDirectory = {
  conversationId: string;
  type: "DIRECT" | "GROUP";
  title: string | null;
  complete: boolean;
  incompleteReason: "too_many_members" | "too_many_devices" | "unreadable_keys" | "not_direct" | null;
  members: Array<{
    userId: string;
    username: string;
    displayName: string | null;
    role: "ADMIN" | "MEMBER";
    devices: Array<{
      deviceId: string;
      deviceName: string;
      identityPublicKey: string;
      signingPublicKey: string;
    }>;
  }>;
};

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function isRawKey(value: Uint8Array): boolean {
  return value.byteLength === 32;
}

/**
 * Public identity directory for one conversation the viewer belongs to.
 * Device rows are copied field by field. Private material is never read.
 */
export function buildIdentityDirectory(input: {
  viewerUserId: string;
  conversationId: string;
  type: "DIRECT" | "GROUP";
  title: string | null;
  members: SafetyDirectoryMember[];
  devices: SafetyDirectoryDevice[];
  queryTruncated: boolean;
}): { ok: true; body: SafetyIdentityDirectory } | SafetyDirectoryFailure {
  const memberIds = input.members.map((member) => member.userId);
  if (new Set(memberIds).size !== memberIds.length) {
    return { ok: false, status: 400, error: "Invalid conversation members" };
  }
  if (!memberIds.includes(input.viewerUserId)) {
    return { ok: false, status: 404, error: "Conversation not found" };
  }

  const tooManyMembers = input.members.length > SAFETY_MAX_MEMBERS;
  const listedMembers = [...input.members]
    .sort((left, right) => (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0))
    .slice(0, 16);

  const active = input.devices.filter((device) =>
    memberIds.includes(device.userId) && (device.revokedAt === undefined || device.revokedAt === null),
  );
  const byUser = new Map<string, SafetyDirectoryDevice[]>();
  let duplicateDevice = false;
  let unreadable = false;
  let tooManyDevices = input.queryTruncated;
  for (const device of active) {
    const list = byUser.get(device.userId) ?? [];
    if (list.some((item) => item.id === device.id)) duplicateDevice = true;
    list.push(device);
    byUser.set(device.userId, list);
  }
  for (const list of byUser.values()) {
    if (list.length > SAFETY_MAX_DEVICES) tooManyDevices = true;
    if (list.some((device) => !isRawKey(device.identityPublicKey) || !isRawKey(device.signingPublicKey))) {
      unreadable = true;
    }
  }

  const notDirect = input.type === "DIRECT" && input.members.length !== 2;
  let incompleteReason: SafetyIdentityDirectory["incompleteReason"] = null;
  if (tooManyMembers) incompleteReason = "too_many_members";
  else if (notDirect) incompleteReason = "not_direct";
  else if (tooManyDevices) incompleteReason = "too_many_devices";
  else if (unreadable || duplicateDevice) incompleteReason = "unreadable_keys";
  const complete = incompleteReason === null;

  return {
    ok: true,
    body: {
      conversationId: input.conversationId,
      type: input.type,
      title: input.title ? clip(input.title, 120) : null,
      complete,
      incompleteReason,
      members: listedMembers.map((member) => ({
        userId: member.userId,
        username: clip(member.username, 64),
        displayName: member.displayName ? clip(member.displayName, 120) : null,
        role: member.role === "ADMIN" ? "ADMIN" : "MEMBER",
        devices: complete
          ? [...(byUser.get(member.userId) ?? [])]
              .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
              .map((device) => ({
                deviceId: device.id,
                deviceName: clip(device.deviceName, 64),
                identityPublicKey: bytesToB64(device.identityPublicKey),
                signingPublicKey: bytesToB64(device.signingPublicKey),
              }))
          : [],
      })),
    },
  };
}

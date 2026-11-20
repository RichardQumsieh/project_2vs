import { asBufferSource, b64ToBytes, concatBytes, utf8ToBytes } from "./bytes";

/**
 * Display fingerprint of Sophia device identity keys.
 *
 * This is not a key-agreement protocol and it does not encrypt anything.
 * Both people hash the same public keys and read the same 60-digit number
 * out of band. A changed number means a device identity key was added,
 * removed, or replaced. It does not prove the app binary is honest.
 */
export const SAFETY_NUMBER_VERSION = "sophia-safety/v1";
export const SAFETY_NUMBER_QR_PREFIX = "sophia-safety-number/v1:";

export const SAFETY_MAX_MEMBERS = 8;
export const SAFETY_MAX_DEVICES = 32;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export type SafetyDevice = {
  deviceId: string;
  identityPublicKey: string;
  signingPublicKey: string;
};

export type SafetyMember = {
  userId: string;
  devices: SafetyDevice[];
};

export type SafetyNumber = {
  digits: string;
  groups: string[];
  grouped: string;
  qrPayload: string;
};

export class SafetyNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyNumberError";
  }
}

function assertId(value: string, label: string) {
  if (!ID_PATTERN.test(value)) {
    throw new SafetyNumberError(`${label} is not a usable id`);
  }
}

function decodeKey(value: string, label: string): Uint8Array {
  if (value.length < 40 || value.length > 48 || /\s/.test(value)) {
    throw new SafetyNumberError(`${label} is not a 32-byte key`);
  }
  let bytes: Uint8Array;
  try {
    bytes = b64ToBytes(value);
  } catch {
    throw new SafetyNumberError(`${label} is not a 32-byte key`);
  }
  if (bytes.length !== 32) {
    throw new SafetyNumberError(`${label} is not a 32-byte key`);
  }
  return bytes;
}

function sortedDevices(devices: SafetyDevice[]): SafetyDevice[] {
  if (devices.length > SAFETY_MAX_DEVICES) {
    throw new SafetyNumberError("Too many devices to fingerprint");
  }
  const seen = new Set<string>();
  for (const device of devices) {
    assertId(device.deviceId, "Device id");
    if (seen.has(device.deviceId)) {
      throw new SafetyNumberError("Duplicate device id");
    }
    seen.add(device.deviceId);
  }
  return [...devices].sort((left, right) => (left.deviceId < right.deviceId ? -1 : left.deviceId > right.deviceId ? 1 : 0));
}

function uint16be(value: number): Uint8Array {
  return Uint8Array.of((value >> 8) & 0xff, value & 0xff);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", asBufferSource(bytes));
  return new Uint8Array(digest);
}

async function sha512(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-512", asBufferSource(bytes));
  return new Uint8Array(digest);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * SHA-256 over the version, user id, and every device identity + signing key.
 * Device display names are not included, so a rename does not change it.
 */
export async function accountFingerprint(userId: string, devices: SafetyDevice[]): Promise<Uint8Array> {
  assertId(userId, "User id");
  const ordered = sortedDevices(devices);
  const parts: Uint8Array[] = [
    utf8ToBytes(SAFETY_NUMBER_VERSION),
    Uint8Array.of(0),
    utf8ToBytes(userId),
    Uint8Array.of(0),
    uint16be(ordered.length),
  ];
  for (const device of ordered) {
    parts.push(
      utf8ToBytes(device.deviceId),
      Uint8Array.of(0),
      decodeKey(device.identityPublicKey, "Identity key"),
      decodeKey(device.signingPublicKey, "Signing key"),
    );
  }
  return sha256(concatBytes(...parts));
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

function formatDigest(digest: Uint8Array): SafetyNumber {
  const groups: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const slice = digest.subarray(index * 5, index * 5 + 5);
    let value = 0;
    for (const byte of slice) value = value * 256 + byte;
    groups.push(String(value % 100000).padStart(5, "0"));
  }
  const digits = groups.join("");
  return {
    digits,
    groups,
    grouped: groups.join(" "),
    qrPayload: `${SAFETY_NUMBER_QR_PREFIX}${digits}`,
  };
}

/**
 * The same 60-digit number for both people. Ordering follows the account
 * fingerprints, not who is looking, so the two screens match.
 */
export async function directSafetyNumber(left: SafetyMember, right: SafetyMember): Promise<SafetyNumber> {
  if (left.userId === right.userId) {
    throw new SafetyNumberError("A direct safety number needs two accounts");
  }
  const leftFingerprint = await accountFingerprint(left.userId, left.devices);
  const rightFingerprint = await accountFingerprint(right.userId, right.devices);
  const order = compareBytes(leftFingerprint, rightFingerprint);
  const firstIsLeft = order < 0 || (order === 0 && left.userId < right.userId);
  const digest = await sha512(concatBytes(
    utf8ToBytes(SAFETY_NUMBER_VERSION),
    utf8ToBytes("/direct"),
    firstIsLeft ? leftFingerprint : rightFingerprint,
    firstIsLeft ? rightFingerprint : leftFingerprint,
  ));
  return formatDigest(digest);
}

/** One number for the whole member set. Member order does not matter. */
export async function groupSafetyNumber(members: SafetyMember[]): Promise<SafetyNumber> {
  if (members.length < 1 || members.length > SAFETY_MAX_MEMBERS) {
    throw new SafetyNumberError("Group size is outside the safety-number cap");
  }
  const seen = new Set<string>();
  for (const member of members) {
    assertId(member.userId, "User id");
    if (seen.has(member.userId)) throw new SafetyNumberError("Duplicate member");
    seen.add(member.userId);
  }
  const ordered = [...members].sort((left, right) => (left.userId < right.userId ? -1 : 1));
  const parts: Uint8Array[] = [
    utf8ToBytes(SAFETY_NUMBER_VERSION),
    utf8ToBytes("/group"),
  ];
  for (const member of ordered) {
    parts.push(utf8ToBytes(member.userId), Uint8Array.of(0), await accountFingerprint(member.userId, member.devices));
  }
  return formatDigest(await sha512(concatBytes(...parts)));
}

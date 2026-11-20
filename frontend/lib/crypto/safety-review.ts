/**
 * Local trust-on-first-use record for safety numbers.
 * The verified bit never leaves this browser.
 */

export const SAFETY_STORE_VERSION = 1;
export const SAFETY_STORE_LIMIT = 100;

export type SafetyReviewState = "unverified" | "verified";
export type SafetyStatus = "unverified" | "verified" | "key_changed" | "incomplete";

export type SafetyRecord = {
  digits: string;
  fingerprints: Record<string, string>;
  state: SafetyReviewState;
  reviewedAt: string;
};

export type SafetyStore = {
  version: typeof SAFETY_STORE_VERSION;
  conversations: Record<string, SafetyRecord>;
};

const DIGITS = /^\d{60}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export function emptySafetyStore(): SafetyStore {
  return { version: SAFETY_STORE_VERSION, conversations: {} };
}

export function sameFingerprintMap(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

export function assessSafety(
  record: SafetyRecord | undefined,
  digits: string,
  fingerprints: Record<string, string>,
): Exclude<SafetyStatus, "incomplete"> {
  if (!record) return "unverified";
  if (record.digits !== digits || !sameFingerprintMap(record.fingerprints, fingerprints)) {
    return "key_changed";
  }
  return record.state;
}

function validFingerprints(value: Record<string, string>): boolean {
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 8) return false;
  return entries.every(([userId, fingerprint]) => ID_PATTERN.test(userId) && FINGERPRINT.test(fingerprint));
}

function validRecord(value: unknown): value is SafetyRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SafetyRecord>;
  return typeof record.digits === "string"
    && DIGITS.test(record.digits)
    && (record.state === "unverified" || record.state === "verified")
    && typeof record.reviewedAt === "string"
    && record.reviewedAt.length <= 40
    && !!record.fingerprints
    && validFingerprints(record.fingerprints);
}

export function parseSafetyStore(raw: string | null): SafetyStore {
  if (!raw || raw.length > 100_000) return emptySafetyStore();
  try {
    const parsed = JSON.parse(raw) as Partial<SafetyStore>;
    if (parsed.version !== SAFETY_STORE_VERSION || !parsed.conversations || typeof parsed.conversations !== "object") {
      return emptySafetyStore();
    }
    const conversations: Record<string, SafetyRecord> = {};
    for (const [id, record] of Object.entries(parsed.conversations)) {
      if (!ID_PATTERN.test(id) || !validRecord(record)) continue;
      conversations[id] = {
        digits: record.digits,
        fingerprints: { ...record.fingerprints },
        state: record.state,
        reviewedAt: record.reviewedAt,
      };
    }
    return { version: SAFETY_STORE_VERSION, conversations: trimStore(conversations) };
  } catch {
    return emptySafetyStore();
  }
}

function trimStore(conversations: Record<string, SafetyRecord>): Record<string, SafetyRecord> {
  const entries = Object.entries(conversations);
  if (entries.length <= SAFETY_STORE_LIMIT) return conversations;
  entries.sort((left, right) => left[1].reviewedAt.localeCompare(right[1].reviewedAt));
  return Object.fromEntries(entries.slice(entries.length - SAFETY_STORE_LIMIT));
}

function assertReviewInput(conversationId: string, digits: string, fingerprints: Record<string, string>) {
  if (!ID_PATTERN.test(conversationId) || !DIGITS.test(digits) || !validFingerprints(fingerprints)) {
    throw new Error("Safety review input is not usable");
  }
}

/** Remember the first complete directory. A later change is left in place so the warning can fire. */
export function observeSafety(
  store: SafetyStore,
  conversationId: string,
  digits: string,
  fingerprints: Record<string, string>,
  reviewedAt: string,
): SafetyStore {
  assertReviewInput(conversationId, digits, fingerprints);
  if (store.conversations[conversationId]) return store;
  return {
    version: SAFETY_STORE_VERSION,
    conversations: trimStore({
      ...store.conversations,
      [conversationId]: { digits, fingerprints: { ...fingerprints }, state: "unverified", reviewedAt },
    }),
  };
}

export function markSafetyVerified(
  store: SafetyStore,
  conversationId: string,
  digits: string,
  fingerprints: Record<string, string>,
  reviewedAt: string,
): SafetyStore {
  assertReviewInput(conversationId, digits, fingerprints);
  return {
    version: SAFETY_STORE_VERSION,
    conversations: {
      ...store.conversations,
      [conversationId]: { digits, fingerprints: { ...fingerprints }, state: "verified", reviewedAt },
    },
  };
}

/** Clears the warning and drops verified. The new keys stay unverified until compared. */
export function acceptSafetyChange(
  store: SafetyStore,
  conversationId: string,
  digits: string,
  fingerprints: Record<string, string>,
  reviewedAt: string,
): SafetyStore {
  assertReviewInput(conversationId, digits, fingerprints);
  return {
    version: SAFETY_STORE_VERSION,
    conversations: {
      ...store.conversations,
      [conversationId]: { digits, fingerprints: { ...fingerprints }, state: "unverified", reviewedAt },
    },
  };
}

export type LocalIdentity = {
  deviceId: string;
  identityPublicKey: string;
  signingPublicKey: string;
};

export type ListedDevice = LocalIdentity;

export function localDeviceStatus(
  local: LocalIdentity | null,
  devices: readonly ListedDevice[],
): "unknown" | "match" | "missing" | "mismatch" {
  if (!local) return "unknown";
  const listed = devices.find((device) => device.deviceId === local.deviceId);
  if (!listed) return "missing";
  if (
    listed.identityPublicKey !== local.identityPublicKey
    || listed.signingPublicKey !== local.signingPublicKey
  ) {
    return "mismatch";
  }
  return "match";
}

import { describe, expect, it } from "vitest";
import {
  acceptSafetyChange,
  assessSafety,
  emptySafetyStore,
  localDeviceStatus,
  markSafetyVerified,
  observeSafety,
  parseSafetyStore,
  sameFingerprintMap,
} from "./safety-review";
import { safetyStorageKey } from "./safety-store";

const chat = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const digits = "123456789012345678901234567890123456789012345678901234567890";
const otherDigits = "123456789012345678901234567890123456789012345678901234567891";
const fingerprints = {
  [alice]: "ab".repeat(32),
  [bob]: "cd".repeat(32),
};
const changed = {
  [alice]: "ab".repeat(32),
  [bob]: "ef".repeat(32),
};

describe("safety review", () => {
  it("treats the first directory as unverified and warns when it later changes", () => {
    const seen = observeSafety(emptySafetyStore(), chat, digits, fingerprints, "2026-11-20T00:00:00.000Z");
    expect(assessSafety(seen.conversations[chat], digits, fingerprints)).toBe("unverified");
    const again = observeSafety(seen, chat, otherDigits, changed, "2026-11-20T01:00:00.000Z");
    expect(again.conversations[chat]?.digits).toBe(digits);
    expect(assessSafety(again.conversations[chat], otherDigits, changed)).toBe("key_changed");
  });

  it("keeps verified until the keys change, and accepting the change drops verified", () => {
    const seen = observeSafety(emptySafetyStore(), chat, digits, fingerprints, "2026-11-20T00:00:00.000Z");
    const verified = markSafetyVerified(seen, chat, digits, fingerprints, "2026-11-20T00:01:00.000Z");
    expect(assessSafety(verified.conversations[chat], digits, fingerprints)).toBe("verified");
    expect(assessSafety(verified.conversations[chat], otherDigits, changed)).toBe("key_changed");
    const accepted = acceptSafetyChange(verified, chat, otherDigits, changed, "2026-11-20T00:02:00.000Z");
    expect(assessSafety(accepted.conversations[chat], otherDigits, changed)).toBe("unverified");
    expect(accepted.conversations[chat]?.state).toBe("unverified");
  });

  it("verifying the new keys stores those keys as verified", () => {
    const seen = observeSafety(emptySafetyStore(), chat, digits, fingerprints, "2026-11-20T00:00:00.000Z");
    const verified = markSafetyVerified(seen, chat, otherDigits, changed, "2026-11-20T00:03:00.000Z");
    expect(assessSafety(verified.conversations[chat], otherDigits, changed)).toBe("verified");
    expect(assessSafety(verified.conversations[chat], digits, fingerprints)).toBe("key_changed");
  });

  it("treats a new or removed member as a key change", () => {
    const seen = markSafetyVerified(emptySafetyStore(), chat, digits, fingerprints, "2026-11-20T00:00:00.000Z");
    const withCarol = { ...fingerprints, "33333333-3333-4333-8333-333333333333": "11".repeat(32) };
    expect(sameFingerprintMap(fingerprints, withCarol)).toBe(false);
    expect(assessSafety(seen.conversations[chat], digits, withCarol)).toBe("key_changed");
  });

  it("drops corrupt storage and keeps accounts in separate keys", () => {
    expect(parseSafetyStore("not-json").conversations).toEqual({});
    expect(parseSafetyStore(JSON.stringify({ version: 2, conversations: {} })).conversations).toEqual({});
    expect(parseSafetyStore(JSON.stringify({
      version: 1,
      conversations: {
        [chat]: { digits, fingerprints, state: "verified", reviewedAt: "2026-11-20T00:00:00.000Z" },
        "bad id": { digits, fingerprints, state: "verified", reviewedAt: "2026-11-20T00:00:00.000Z" },
      },
    })).conversations[chat]?.state).toBe("verified");
    expect(safetyStorageKey(alice)).not.toBe(safetyStorageKey(bob));
  });

  it("compares this browser's device with the listed keys", () => {
    const local = { deviceId: "device-1", identityPublicKey: "a", signingPublicKey: "b" };
    expect(localDeviceStatus(null, [local])).toBe("unknown");
    expect(localDeviceStatus(local, [local])).toBe("match");
    expect(localDeviceStatus(local, [])).toBe("missing");
    expect(localDeviceStatus(local, [{ ...local, identityPublicKey: "c" }])).toBe("mismatch");
  });
});

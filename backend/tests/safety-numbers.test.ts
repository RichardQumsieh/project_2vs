import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIdentityDirectory,
  gateSafetyNumbers,
  type SafetyDirectoryDevice,
  type SafetyDirectoryMember,
} from "../src/safety-numbers.js";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const carol = "33333333-3333-4333-8333-333333333333";
const chat = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function key(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function member(
  userId: string,
  username: string,
  extras: Record<string, string> = {},
): SafetyDirectoryMember {
  return {
    userId,
    username,
    displayName: username,
    role: "MEMBER",
    ...extras,
  } as SafetyDirectoryMember;
}

function device(userId: string, id: string, byte: number): SafetyDirectoryDevice {
  return {
    id,
    userId,
    deviceName: "phone",
    identityPublicKey: key(byte),
    signingPublicKey: key(byte + 1),
  };
}

describe("safety number directory", () => {
  it("stays disabled unless the feature flag is on", () => {
    const disabled = gateSafetyNumbers(false);
    assert.equal(disabled.ok, false);
    if (!disabled.ok) {
      assert.equal(disabled.status, 503);
      assert.equal(disabled.code, "safety_numbers_disabled");
    }
    assert.equal(gateSafetyNumbers(true).ok, true);
  });

  it("hides the directory from someone who is not a member", () => {
    const hidden = buildIdentityDirectory({
      viewerUserId: carol,
      conversationId: chat,
      type: "DIRECT",
      title: null,
      members: [member(alice, "ada"), member(bob, "sara")],
      devices: [device(alice, "device-a", 1), device(bob, "device-b", 3)],
      queryTruncated: false,
    });
    assert.equal(hidden.ok, false);
    if (!hidden.ok) assert.equal(hidden.status, 404);
  });

  it("returns only public identity keys for the two direct members", () => {
    const listed = buildIdentityDirectory({
      viewerUserId: alice,
      conversationId: chat,
      type: "DIRECT",
      title: null,
      members: [
        member(alice, "ada", { email: "ada@example.com", privateKey: "super-secret-private" }),
        member(bob, "sara"),
      ],
      devices: [
        device(alice, "device-a", 1),
        device(bob, "device-b", 3),
        { ...device(bob, "device-old", 8), revokedAt: new Date("2026-11-01T00:00:00.000Z") },
        device(carol, "device-stranger", 9),
      ],
      queryTruncated: false,
    });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.body.complete, true);
    assert.equal(listed.body.members.length, 2);
    const bobDevices = listed.body.members.find((item) => item.userId === bob)?.devices ?? [];
    assert.equal(bobDevices.length, 1);
    assert.equal(bobDevices[0]?.deviceId, "device-b");
    assert.equal(Buffer.from(bobDevices[0]!.identityPublicKey, "base64").length, 32);
    const serialized = JSON.stringify(listed.body);
    assert.equal(serialized.includes("ada@example.com"), false);
    assert.equal(serialized.includes("super-secret-private"), false);
    assert.equal(serialized.includes("plaintext"), false);
    assert.equal(serialized.includes("signedPreKey"), false);
    assert.equal(serialized.includes("device-stranger"), false);
    assert.equal(serialized.includes("device-old"), false);
    const allowed = new Set([
      "conversationId",
      "type",
      "title",
      "complete",
      "incompleteReason",
      "members",
      "userId",
      "username",
      "displayName",
      "role",
      "devices",
      "deviceId",
      "deviceName",
      "identityPublicKey",
      "signingPublicKey",
    ]);
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) {
        for (const child of value) walk(child);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [keyName, child] of Object.entries(value)) {
        keys.add(keyName);
        walk(child);
      }
    };
    walk(listed.body);
    for (const keyName of keys) assert.equal(allowed.has(keyName), true, keyName);
  });

  it("withholds every key when the device list is truncated or unreadable", () => {
    const truncated = buildIdentityDirectory({
      viewerUserId: alice,
      conversationId: chat,
      type: "GROUP",
      title: "Leadership",
      members: [member(alice, "ada"), member(bob, "sara")],
      devices: [device(alice, "device-a", 1)],
      queryTruncated: true,
    });
    assert.equal(truncated.ok, true);
    if (!truncated.ok) return;
    assert.equal(truncated.body.complete, false);
    assert.equal(truncated.body.incompleteReason, "too_many_devices");
    assert.deepEqual(truncated.body.members.flatMap((item) => item.devices), []);

    const broken = buildIdentityDirectory({
      viewerUserId: alice,
      conversationId: chat,
      type: "DIRECT",
      title: null,
      members: [member(alice, "ada"), member(bob, "sara")],
      devices: [{
        ...device(bob, "device-b", 3),
        identityPublicKey: new Uint8Array(16),
      }],
      queryTruncated: false,
    });
    assert.equal(broken.ok, true);
    if (!broken.ok) return;
    assert.equal(broken.body.incompleteReason, "unreadable_keys");
    assert.equal(JSON.stringify(broken.body).includes("identityPublicKey\":\"\""), false);
    assert.deepEqual(broken.body.members.flatMap((item) => item.devices), []);
  });

  it("does not build a direct number for the wrong membership shape", () => {
    const alone = buildIdentityDirectory({
      viewerUserId: alice,
      conversationId: chat,
      type: "DIRECT",
      title: null,
      members: [member(alice, "ada")],
      devices: [device(alice, "device-a", 1)],
      queryTruncated: false,
    });
    assert.equal(alone.ok, true);
    if (!alone.ok) return;
    assert.equal(alone.body.complete, false);
    assert.equal(alone.body.incompleteReason, "not_direct");
  });
});

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { describe, it } from "node:test";
import {
  admitGroupBlob,
  canReadGroupBlob,
  countUnreadGroupApplications,
  gateGroupE2ee,
  groupAccess,
  keyPackageBoundToDevice,
  planGroupMembers,
  planGroupRename,
  planMembershipChange,
  planRoleChange,
  validateGroupBlob,
} from "../src/group-e2ee.js";
import { parseGroupE2eeEnabled } from "../src/group-e2ee-flag.js";
import { postGroupMlsBlobSchema } from "../src/schemas.js";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const carol = "33333333-3333-4333-8333-333333333333";
const alicePhone = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const bobPhone = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

describe("group E2EE server policy", () => {
  it("stays disabled unless the feature flag is on", () => {
    const disabled = gateGroupE2ee(false);
    assert.equal(disabled.ok, false);
    if (!disabled.ok) {
      assert.equal(disabled.status, 503);
      assert.equal(disabled.code, "group_e2ee_disabled");
    }
    assert.equal(gateGroupE2ee(true).ok, true);
  });

  it("is on unless the env value is exactly false", () => {
    assert.equal(parseGroupE2eeEnabled(undefined), true);
    assert.equal(parseGroupE2eeEnabled(""), true);
    assert.equal(parseGroupE2eeEnabled("true"), true);
    assert.equal(parseGroupE2eeEnabled("false"), false);
  });

  it("creates a group of at most 8 members including the creator", () => {
    const created = planGroupMembers(alice, [bob]);
    assert.equal(created.ok, true);
    if (created.ok) {
      assert.deepEqual(created.members, [
        { userId: alice, role: "ADMIN" },
        { userId: bob, role: "MEMBER" },
      ]);
    }

    const eightOthers = Array.from({ length: 8 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const tooBig = planGroupMembers(alice, eightOthers);
    assert.equal(tooBig.ok, false);
  });

  it("hides subsequent blobs from a removed member", () => {
    const members = [
      { userId: alice, role: "ADMIN" as const },
      { userId: bob, role: "MEMBER" as const },
      { userId: carol, role: "MEMBER" as const },
    ];
    const removed = planMembershipChange(members, alice, { op: "remove", userId: bob });
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.deepEqual(removed.members.map((member) => member.userId), [alice, carol]);
    const access = groupAccess(removed.members.map((member) => member.userId), bob);
    assert.equal(access.ok, false);
    if (!access.ok) assert.equal(access.status, 404);

    const later = {
      kind: "application" as const,
      senderDeviceId: alicePhone,
      recipientDeviceId: null,
      viewerDeviceId: bobPhone,
      viewerIsMember: false,
    };
    assert.equal(canReadGroupBlob(later), false);
    assert.equal(canReadGroupBlob({ ...later, viewerDeviceId: alicePhone, viewerIsMember: true }), true);
  });

  it("lets only an admin change other members, and lets a member leave", () => {
    const members = [
      { userId: alice, role: "ADMIN" as const },
      { userId: bob, role: "MEMBER" as const },
      { userId: carol, role: "MEMBER" as const },
    ];
    const memberAdds = planMembershipChange(members, bob, { op: "add", userId: "44444444-4444-4444-8444-444444444444" });
    assert.equal(memberAdds.ok, false);
    if (!memberAdds.ok) assert.equal(memberAdds.status, 403);

    const memberRemoves = planMembershipChange(members, bob, { op: "remove", userId: carol });
    assert.equal(memberRemoves.ok, false);
    if (!memberRemoves.ok) assert.equal(memberRemoves.status, 403);

    const selfLeave = planMembershipChange(members, bob, { op: "remove", userId: bob });
    assert.equal(selfLeave.ok, true);

    const lastAdmin = planMembershipChange(
      [{ userId: alice, role: "ADMIN" }, { userId: bob, role: "MEMBER" }],
      alice,
      { op: "remove", userId: alice },
    );
    assert.equal(lastAdmin.ok, false);
    if (!lastAdmin.ok) assert.equal(lastAdmin.status, 409);
  });

  it("stores opaque ciphertext and rejects a plaintext field", () => {
    const secret = "board decision: acquire northwind";
    const ciphertext = Buffer.from("mls-ciphertext-not-the-board-decision");
    const rejected = postGroupMlsBlobSchema.safeParse({
      senderDeviceId: alicePhone,
      kind: "application",
      payload: ciphertext.toString("base64"),
      plaintext: secret,
    });
    assert.equal(rejected.success, false);

    const accepted = postGroupMlsBlobSchema.safeParse({
      senderDeviceId: alicePhone,
      kind: "application",
      payload: ciphertext.toString("base64"),
    });
    assert.equal(accepted.success, true);
    if (!accepted.success) return;
    const stored = validateGroupBlob({ ...accepted.data, senderDeviceId: alicePhone });
    assert.equal(stored.ok, true);
    if (!stored.ok) return;
    assert.deepEqual(Buffer.from(stored.payload), ciphertext);
    assert.equal(Buffer.from(stored.payload).toString("utf8").includes(secret), false);
    assert.equal(JSON.stringify(stored).includes(secret), false);
  });

  it("requires a device binding on key packages and a recipient on welcomes", () => {
    const payload = Buffer.from("opaque-key-package").toString("base64");
    const missingBinding = validateGroupBlob({
      kind: "key_package",
      payload,
      senderDeviceId: alicePhone,
    });
    assert.equal(missingBinding.ok, false);

    const welcome = validateGroupBlob({
      kind: "welcome",
      payload,
      senderDeviceId: alicePhone,
      recipientDeviceId: bobPhone,
    });
    assert.equal(welcome.ok, true);
    if (welcome.ok) assert.equal(welcome.recipientDeviceId, bobPhone);

    assert.equal(
      canReadGroupBlob({
        kind: "welcome",
        senderDeviceId: alicePhone,
        recipientDeviceId: bobPhone,
        viewerDeviceId: carol,
        viewerIsMember: true,
      }),
      false,
    );
    assert.equal(
      canReadGroupBlob({
        kind: "welcome",
        senderDeviceId: alicePhone,
        recipientDeviceId: bobPhone,
        viewerDeviceId: bobPhone,
        viewerIsMember: true,
      }),
      true,
    );
  });

  it("verifies a Web Crypto Ed25519 device signature over the opaque key package", async () => {
    const keyPair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const publicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", keyPair.publicKey));
    const payload = new TextEncoder().encode("mls key package bytes");
    const signature = new Uint8Array(
      await webcrypto.subtle.sign("Ed25519", keyPair.privateKey, payload),
    );
    assert.equal(
      keyPackageBoundToDevice({ signingPublicKey: publicKey, payload, bindingSignature: signature }),
      true,
    );
    payload[0] ^= 0xff;
    assert.equal(
      keyPackageBoundToDevice({ signingPublicKey: publicKey, payload, bindingSignature: signature }),
      false,
    );
  });

  it("promotes a second admin and refuses to demote the last one", () => {
    const members = [
      { userId: alice, role: "ADMIN" as const },
      { userId: bob, role: "MEMBER" as const },
      { userId: carol, role: "MEMBER" as const },
    ];
    const memberPromotes = planRoleChange(members, bob, carol, "ADMIN");
    assert.equal(memberPromotes.ok, false);
    if (!memberPromotes.ok) assert.equal(memberPromotes.status, 403);

    const promoted = planRoleChange(members, alice, bob, "ADMIN");
    assert.equal(promoted.ok, true);
    if (!promoted.ok) return;
    assert.equal(promoted.members.find((member) => member.userId === bob)?.role, "ADMIN");

    const demoteLast = planRoleChange(
      [{ userId: alice, role: "ADMIN" }, { userId: bob, role: "MEMBER" }],
      alice,
      alice,
      "MEMBER",
    );
    assert.equal(demoteLast.ok, false);
    if (!demoteLast.ok) {
      assert.equal(demoteLast.status, 409);
      assert.equal(demoteLast.code, "last_admin");
    }

    const demoteOneOfTwo = planRoleChange(promoted.members, alice, bob, "MEMBER");
    assert.equal(demoteOneOfTwo.ok, true);
    const otherAdminLeaves = planMembershipChange(promoted.members, bob, { op: "remove", userId: bob });
    assert.equal(otherAdminLeaves.ok, true);
  });

  it("rejects malformed, out-of-order, and forked commits without reading ciphertext", () => {
    const secret = "board decision: acquire northwind";
    const groupId = "44444444-4444-4444-8444-444444444444";
    const commit = privateMessage(groupId, 0, 3, Buffer.from(secret));
    const first = admitGroupBlob({
      kind: "commit",
      payload: commit.toString("base64"),
      senderDeviceId: alicePhone,
      conversationId: groupId,
      currentEpoch: 0,
      commitRecordedForCurrentEpoch: false,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.recordCommit, true);
    assert.equal(first.nextEpoch, 1);
    assert.equal(first.epoch, 0);
    assert.equal(JSON.stringify({ epoch: first.epoch, nextEpoch: first.nextEpoch }).includes(secret), false);

    const fork = admitGroupBlob({
      kind: "commit",
      payload: commit.toString("base64"),
      senderDeviceId: bobPhone,
      conversationId: groupId,
      currentEpoch: 0,
      commitRecordedForCurrentEpoch: true,
    });
    assert.equal(fork.ok, false);
    if (!fork.ok) assert.equal(fork.code, "mls_epoch_conflict");

    const stale = admitGroupBlob({
      kind: "application",
      payload: privateMessage(groupId, 0, 1, Buffer.from("later")).toString("base64"),
      senderDeviceId: alicePhone,
      conversationId: groupId,
      currentEpoch: 1,
      commitRecordedForCurrentEpoch: false,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "mls_epoch_order");

    const current = admitGroupBlob({
      kind: "application",
      payload: privateMessage(groupId, 1, 1, Buffer.from(secret)).toString("base64"),
      senderDeviceId: alicePhone,
      conversationId: groupId,
      currentEpoch: 1,
      commitRecordedForCurrentEpoch: false,
    });
    assert.equal(current.ok, true);
    if (current.ok) assert.equal(current.recordCommit, false);

    const truncated = admitGroupBlob({
      kind: "commit",
      payload: Buffer.from([0, 1, 0, 2, 4]).toString("base64"),
      senderDeviceId: alicePhone,
      conversationId: groupId,
      currentEpoch: 0,
      commitRecordedForCurrentEpoch: false,
    });
    assert.equal(truncated.ok, false);
    if (!truncated.ok) assert.equal(truncated.code, "mls_malformed");

    const wrongKind = admitGroupBlob({
      kind: "commit",
      payload: privateMessage(groupId, 0, 1, Buffer.from("not-a-commit")).toString("base64"),
      senderDeviceId: alicePhone,
      conversationId: groupId,
      currentEpoch: 0,
      commitRecordedForCurrentEpoch: false,
    });
    assert.equal(wrongKind.ok, false);
    if (!wrongKind.ok) assert.equal(wrongKind.code, "mls_malformed");

    const welcome = admitGroupBlob({
      kind: "welcome",
      payload: welcomeBytes().toString("base64"),
      senderDeviceId: alicePhone,
      recipientDeviceId: bobPhone,
      conversationId: groupId,
      currentEpoch: 1,
      commitRecordedForCurrentEpoch: false,
    });
    assert.equal(welcome.ok, true);
    if (welcome.ok) assert.equal(welcome.nextEpoch, 1);

    const keyPackage = admitGroupBlob({
      kind: "key_package",
      payload: keyPackageBytes().toString("base64"),
      senderDeviceId: alicePhone,
      bindingSignature: Buffer.alloc(64, 7).toString("base64"),
      conversationId: groupId,
      currentEpoch: 0,
      commitRecordedForCurrentEpoch: false,
    });
    assert.equal(keyPackage.ok, true);
  });

  it("counts unread group applications after the read cursor and skips the sender", () => {
    const groupId = "44444444-4444-4444-8444-444444444444";
    const blobs = [
      { id: "a", conversationId: groupId, kind: "application", createdAt: "2026-01-01T00:00:00.000Z", senderUserId: bob },
      { id: "b", conversationId: groupId, kind: "commit", createdAt: "2026-01-01T00:00:01.000Z", senderUserId: alice },
      { id: "c", conversationId: groupId, kind: "application", createdAt: "2026-01-01T00:00:02.000Z", senderUserId: alice },
      { id: "d", conversationId: groupId, kind: "application", createdAt: "2026-01-01T00:00:03.000Z", senderUserId: carol },
    ];
    assert.equal(countUnreadGroupApplications({
      blobs,
      conversationId: groupId,
      viewerUserId: alice,
      readThrough: null,
    }), 2);
    assert.equal(countUnreadGroupApplications({
      blobs,
      conversationId: groupId,
      viewerUserId: alice,
      readThrough: { id: "b", createdAt: "2026-01-01T00:00:01.000Z" },
    }), 1);
  });
});

function u16(value: number) {
  return Buffer.from([(value >> 8) & 0xff, value & 0xff]);
}

function vl(bytes: Buffer) {
  if (bytes.length >= 64) throw new Error("test vector too long");
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

function privateMessage(groupId: string, epoch: number, contentType: number, ciphertext: Buffer) {
  const epochBytes = Buffer.alloc(8);
  epochBytes.writeBigUInt64BE(BigInt(epoch));
  return Buffer.concat([
    u16(1),
    u16(2),
    vl(Buffer.from(groupId)),
    epochBytes,
    Buffer.from([contentType]),
    vl(Buffer.alloc(0)),
    vl(Buffer.from("sender-data")),
    vl(ciphertext),
  ]);
}

function welcomeBytes() {
  return Buffer.concat([
    u16(1),
    u16(3),
    u16(1),
    vl(Buffer.from("secrets")),
    vl(Buffer.from("group-info")),
  ]);
}

function keyPackageBytes() {
  const leaf = Buffer.concat([
    vl(Buffer.from([1])),
    vl(Buffer.from([2])),
    u16(1),
    vl(Buffer.from("device")),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from([1]),
    Buffer.alloc(16),
    vl(Buffer.alloc(0)),
    vl(Buffer.from([9])),
  ]);
  return Buffer.concat([
    u16(1),
    u16(5),
    u16(1),
    u16(1),
    vl(Buffer.from([4])),
    leaf,
    vl(Buffer.alloc(0)),
    vl(Buffer.from([8])),
  ]);
}

describe("group rename", () => {
  it("lets an admin rename and refuses a member", () => {
    const members = [
      { userId: alice, role: "ADMIN" as const },
      { userId: bob, role: "MEMBER" as const },
    ];
    assert.equal(planGroupRename(members, alice).ok, true);
    const refused = planGroupRename(members, bob);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.status, 403);
    const missing = planGroupRename(members, carol);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);
  });
});

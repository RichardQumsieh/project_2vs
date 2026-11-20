import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { describe, it } from "node:test";
import {
  canReadGroupBlob,
  gateGroupE2ee,
  groupAccess,
  keyPackageBoundToDevice,
  planGroupMembers,
  planMembershipChange,
  validateGroupBlob,
} from "../src/group-e2ee.js";
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
});

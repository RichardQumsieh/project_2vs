import { describe, expect, it } from "vitest";
import { createIdentityMaterial } from "./identity";
import { encryptForDevice } from "./multi-device";
import { ratchetDecrypt, ratchetEncrypt } from "./ratchet";
import {
  acceptSession,
  initiateSession,
  type PreKeyBundle,
} from "./x3dh";

function bundleFor(
  identity: Awaited<ReturnType<typeof createIdentityMaterial>>,
  deviceId: string,
): PreKeyBundle {
  const oneTimePreKey = identity.oneTimePreKeys[0];
  return {
    deviceId,
    identityPublicKey: identity.identity.x25519.publicKey,
    signingPublicKey: identity.identity.signing.publicKey,
    signedPreKey: {
      id: identity.signedPreKey.keyId,
      publicKey: identity.signedPreKey.publicKey,
      signature: identity.signedPreKey.signature,
    },
    oneTimePreKey: oneTimePreKey
      ? {
          id: oneTimePreKey.keyId,
          publicKey: oneTimePreKey.publicKey,
        }
      : undefined,
  };
}

describe("initial X3DH and ratchet messages", () => {
  it("decrypts the initiator's first message and the responder's first reply", async () => {
    const alice = await createIdentityMaterial(1);
    const bob = await createIdentityMaterial(1);
    const initiated = await initiateSession(alice, bundleFor(bob, "bob-device"));
    const first = await ratchetEncrypt(
      initiated.state,
      "first message from Alice",
      initiated.extra,
    );
    const bobIncoming = await acceptSession(
      bob,
      alice.identity.x25519.publicKey,
      first.ratchetHeader.dh,
      first.ratchetHeader.otkId,
    );
    const firstReceived = await ratchetDecrypt(
      bobIncoming,
      first.ratchetHeader,
      first.ciphertext,
      first.nonce,
    );

    expect(firstReceived.plaintext).toBe("first message from Alice");

    const bobInitiated = await initiateSession(bob, bundleFor(alice, "alice-device"));
    const reply = await ratchetEncrypt(
      bobInitiated.state,
      "reply from Bob",
      bobInitiated.extra,
    );
    const aliceIncoming = await acceptSession(
      alice,
      bob.identity.x25519.publicKey,
      reply.ratchetHeader.dh,
      reply.ratchetHeader.otkId,
    );
    const replyReceived = await ratchetDecrypt(
      aliceIncoming,
      reply.ratchetHeader,
      reply.ciphertext,
      reply.nonce,
    );

    expect(replyReceived.plaintext).toBe("reply from Bob");
  });

  it("continues ratcheting independently after both peers initialize sessions", async () => {
    const alice = await createIdentityMaterial(1);
    const bob = await createIdentityMaterial(1);
    const aliceToBob = await initiateSession(alice, bundleFor(bob, "bob-device"));
    const bobFirst = await ratchetEncrypt(
      aliceToBob.state,
      "Alice 1",
      aliceToBob.extra,
    );
    const bobIncoming = await acceptSession(
      bob,
      alice.identity.x25519.publicKey,
      bobFirst.ratchetHeader.dh,
      bobFirst.ratchetHeader.otkId,
    );
    const bobReceived = await ratchetDecrypt(
      bobIncoming,
      bobFirst.ratchetHeader,
      bobFirst.ciphertext,
      bobFirst.nonce,
    );
    expect(bobReceived.plaintext).toBe("Alice 1");

    const bobToAlice = await initiateSession(bob, bundleFor(alice, "alice-device"));
    const bobFirstReply = await ratchetEncrypt(
      bobToAlice.state,
      "Bob 1",
      bobToAlice.extra,
    );
    const aliceIncoming = await acceptSession(
      alice,
      bob.identity.x25519.publicKey,
      bobFirstReply.ratchetHeader.dh,
      bobFirstReply.ratchetHeader.otkId,
    );
    const aliceReceived = await ratchetDecrypt(
      aliceIncoming,
      bobFirstReply.ratchetHeader,
      bobFirstReply.ciphertext,
      bobFirstReply.nonce,
    );
    expect(aliceReceived.plaintext).toBe("Bob 1");

    const bobContinued = await ratchetEncrypt(
      bobToAlice.state,
      "Bob 2",
    );
    const aliceContinued = await ratchetDecrypt(
      aliceReceived.state,
      bobContinued.ratchetHeader,
      bobContinued.ciphertext,
      bobContinued.nonce,
    );
    expect(aliceContinued.plaintext).toBe("Bob 2");
  });

  it("recovers the initial message when later messages arrive first", async () => {
    const alice = await createIdentityMaterial(1);
    const bob = await createIdentityMaterial(1);
    const initiated = await initiateSession(alice, bundleFor(bob, "bob-device"));
    const first = await ratchetEncrypt(
      initiated.state,
      "first",
      initiated.extra,
    );
    const second = await ratchetEncrypt(initiated.state, "second");
    const bobIncoming = await acceptSession(
      bob,
      alice.identity.x25519.publicKey,
      first.ratchetHeader.dh,
      first.ratchetHeader.otkId,
    );

    const secondReceived = await ratchetDecrypt(
      bobIncoming,
      second.ratchetHeader,
      second.ciphertext,
      second.nonce,
    );
    const firstReceived = await ratchetDecrypt(
      secondReceived.state,
      first.ratchetHeader,
      first.ciphertext,
      first.nonce,
    );

    expect(secondReceived.plaintext).toBe("second");
    expect(firstReceived.plaintext).toBe("first");
  });

  it("creates independent envelopes that each decrypt only on their target device", async () => {
    const alice = await createIdentityMaterial(1);
    const bobPhone = await createIdentityMaterial(1);
    const bobLaptop = await createIdentityMaterial(1);
    const phoneBundle = bundleFor(bobPhone, "bob-phone");
    const laptopBundle = bundleFor(bobLaptop, "bob-laptop");

    const phone = await encryptForDevice(
      alice,
      "conversation",
      "private to Bob's devices",
      phoneBundle.deviceId,
      phoneBundle,
      undefined,
    );
    const laptop = await encryptForDevice(
      alice,
      "conversation",
      "private to Bob's devices",
      laptopBundle.deviceId,
      laptopBundle,
      undefined,
    );
    const phoneFollowup = await encryptForDevice(
      alice,
      "conversation",
      "follow-up",
      phoneBundle.deviceId,
      undefined,
      phone.session,
    );

    expect(phone.envelope.ratchetHeader.recipientDeviceId).toBe("bob-phone");
    expect(laptop.envelope.ratchetHeader.recipientDeviceId).toBe("bob-laptop");

    const phoneState = await acceptSession(
      bobPhone,
      alice.identity.x25519.publicKey,
      phoneFollowup.envelope.ratchetHeader.dh,
      phoneFollowup.envelope.ratchetHeader.otkId,
    );
    const laptopState = await acceptSession(
      bobLaptop,
      alice.identity.x25519.publicKey,
      laptop.envelope.ratchetHeader.dh,
      laptop.envelope.ratchetHeader.otkId,
    );
    await expect(
      ratchetDecrypt(
        structuredClone(phoneState),
        {
          ...phone.envelope.ratchetHeader,
          recipientDeviceId: "bob-laptop",
        },
        phone.envelope.ciphertext,
        phone.envelope.nonce,
      ),
    ).rejects.toThrow();

    const phoneFollowupMessage = await ratchetDecrypt(
      phoneState,
      phoneFollowup.envelope.ratchetHeader,
      phoneFollowup.envelope.ciphertext,
      phoneFollowup.envelope.nonce,
    );
    const phoneMessage = await ratchetDecrypt(
      phoneFollowupMessage.state,
      phone.envelope.ratchetHeader,
      phone.envelope.ciphertext,
      phone.envelope.nonce,
    );
    const laptopMessage = await ratchetDecrypt(
      laptopState,
      laptop.envelope.ratchetHeader,
      laptop.envelope.ciphertext,
      laptop.envelope.nonce,
    );

    expect(phoneFollowupMessage.plaintext).toBe("follow-up");
    expect(phoneMessage.plaintext).toBe("private to Bob's devices");
    expect(laptopMessage.plaintext).toBe("private to Bob's devices");
    expect(phone.session.remoteDeviceId).not.toBe(laptop.session.remoteDeviceId);
  });
});

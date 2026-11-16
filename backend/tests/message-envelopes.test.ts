import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sendMessageSchema } from "../src/schemas.js";

describe("multi-device message envelopes", () => {
  it("accepts one authenticated ciphertext envelope per device", () => {
    const result = sendMessageSchema.safeParse({
      senderDeviceId: "11111111-1111-4111-8111-111111111111",
      envelopes: [
        {
          recipientDeviceId: "22222222-2222-4222-8222-222222222222",
          ciphertext: "ciphertext",
          nonce: "nonce",
          ratchetHeader: {
            version: 1,
            recipientDeviceId: "22222222-2222-4222-8222-222222222222",
          },
        },
      ],
    });

    it("accepts a sender-supplied archive envelope for each conversation account", () => {
      const publicKey = `${"A".repeat(43)}=`;
      const result = sendMessageSchema.safeParse({
        senderDeviceId: "11111111-1111-4111-8111-111111111111",
        logicalMessageId: "44444444-4444-4444-8444-444444444444",
        envelopes: [
          {
            recipientDeviceId: "22222222-2222-4222-8222-222222222222",
            ciphertext: "ciphertext",
            nonce: "nonce",
            ratchetHeader: {
              recipientDeviceId: "22222222-2222-4222-8222-222222222222",
            },
          },
        ],
        archiveEnvelopes: [
          {
            ownerUserId: "55555555-5555-4555-8555-555555555555",
            recipientPublicKey: publicKey,
            ephemeralPublicKey: publicKey,
            nonce: "A".repeat(16),
            ciphertext: "A".repeat(24),
          },
          {
            ownerUserId: "66666666-6666-4666-8666-666666666666",
            recipientPublicKey: publicKey,
            ephemeralPublicKey: publicKey,
            nonce: "A".repeat(16),
            ciphertext: "A".repeat(24),
          },
        ],
      });

      assert.equal(result.success, true);
    });

    assert.equal(result.success, true);
  });

  it("rejects duplicate envelopes for the same recipient device", () => {
    const envelope = {
      recipientDeviceId: "22222222-2222-4222-8222-222222222222",
      ciphertext: "ciphertext",
      nonce: "nonce",
      ratchetHeader: {},
    };
    const result = sendMessageSchema.safeParse({
      senderDeviceId: "11111111-1111-4111-8111-111111111111",
      envelopes: [envelope, envelope],
    });

    assert.equal(result.success, false);
  });

  it("rejects an envelope whose encrypted recipient differs from its route target", () => {
    const result = sendMessageSchema.safeParse({
      senderDeviceId: "11111111-1111-4111-8111-111111111111",
      envelopes: [
        {
          recipientDeviceId: "22222222-2222-4222-8222-222222222222",
          ciphertext: "ciphertext",
          nonce: "nonce",
          ratchetHeader: {
            recipientDeviceId: "33333333-3333-4333-8333-333333333333",
          },
        },
      ],
    });

    assert.equal(result.success, false);
  });

  it("continues accepting legacy single-envelope submissions", () => {
    const result = sendMessageSchema.safeParse({
      senderDeviceId: "11111111-1111-4111-8111-111111111111",
      ciphertext: "ciphertext",
      nonce: "nonce",
      ratchetHeader: {},
    });

    assert.equal(result.success, true);
  });
});

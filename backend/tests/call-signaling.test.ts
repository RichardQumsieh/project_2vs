import assert from "node:assert/strict";
import test from "node:test";
import { callSignalSchema } from "../src/schemas.js";

const callId = "e8cfa520-3e79-40db-9d85-497a1bdc9917";
const conversationId = "cc1bebdc-bf72-47fd-a15b-4c357d01b220";

test("one-to-one call signaling schemas", async (t) => {
  await t.test("accepts bounded audio/video offers, answers, and ICE candidates", () => {
    assert.equal(callSignalSchema.safeParse({
      type: "call:invite",
      callId,
      conversationId,
      mode: "video",
      offer: { type: "offer", sdp: "v=0\r\n" },
    }).success, true);
    assert.equal(callSignalSchema.safeParse({
      type: "call:answer",
      callId,
      conversationId,
      answer: { type: "answer", sdp: "v=0\r\n" },
    }).success, true);
    assert.equal(callSignalSchema.safeParse({
      type: "call:ice",
      callId,
      conversationId,
      candidate: { candidate: "candidate:1 1 UDP 1 192.0.2.1 5000 typ host" },
    }).success, true);
  });

  await t.test("rejects malformed, oversized, or client-addressed signals", () => {
    assert.equal(callSignalSchema.safeParse({
      type: "call:invite",
      callId: "not-a-uuid",
      conversationId,
      mode: "video",
      offer: { type: "offer", sdp: "v=0" },
    }).success, false);
    assert.equal(callSignalSchema.safeParse({
      type: "call:answer",
      callId,
      conversationId,
      answer: { type: "offer", sdp: "v=0" },
    }).success, false);
    assert.equal(callSignalSchema.safeParse({
      type: "call:invite",
      callId,
      conversationId,
      mode: "audio",
      offer: { type: "offer", sdp: "x".repeat(64 * 1024 + 1) },
    }).success, false);
    assert.equal(callSignalSchema.safeParse({
      type: "call:end",
      callId,
      conversationId,
      to: "another-user",
    }).success, false);
    assert.equal(callSignalSchema.safeParse({
      type: "call:group-offer",
      callId,
      conversationId,
      peerId: "not-a-uuid",
      offer: { type: "offer", sdp: "v=0" },
    }).success, false);
    assert.equal(callSignalSchema.safeParse({
      type: "call:group-leave",
      callId,
      conversationId,
      to: "another-user",
    }).success, false);
  });

  await t.test("accepts group mesh signals without a client-chosen route outside the schema", () => {
    const peerId = "6d5f1c2a-0b34-4f0e-9a1c-2b7e5d8c4a11";
    assert.equal(callSignalSchema.safeParse({
      type: "call:group-invite",
      callId,
      conversationId,
      mode: "audio",
    }).success, true);
    assert.equal(callSignalSchema.safeParse({
      type: "call:group-offer",
      callId,
      conversationId,
      peerId,
      offer: { type: "offer", sdp: "v=0\r\n" },
    }).success, true);
    assert.equal(callSignalSchema.safeParse({
      type: "call:group-ice",
      callId,
      conversationId,
      peerId,
      candidate: { candidate: "candidate:1 1 UDP 1 192.0.2.1 5000 typ host" },
    }).success, true);
  });
});

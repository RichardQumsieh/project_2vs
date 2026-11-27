import { describe, expect, it } from "vitest";
import { encodeCallPayload, encodeImagePayload, parseChatPayload } from "../../frontend/lib/chat-payload";
import { decryptPhotoBytes, encryptPhotoBytes } from "../../frontend/lib/crypto/media";
import { decryptVideoBytes, encryptVideoBytes } from "../../frontend/lib/crypto/video";
import { decryptVoiceNoteBytes, encryptVoiceNoteBytes } from "../../frontend/lib/crypto/voice-note";

async function bytesOf(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("attachment encryption", () => {
  it("round-trips a photo and never puts the plaintext in the ciphertext", async () => {
    const plaintext = new Uint8Array([0xff, 0xd8, 0xff, 0x11, 0x22, 0x33, 0xd9]);
    const encrypted = await encryptPhotoBytes(plaintext, "image/jpeg");
    expect(encrypted.ciphertext).not.toEqual(plaintext);
    expect(Buffer.from(encrypted.ciphertext).includes(Buffer.from(plaintext))).toBe(false);
    const opened = await decryptPhotoBytes(encrypted.ciphertext, encrypted.key, encrypted.nonce, encrypted.mime);
    expect(await bytesOf(opened)).toEqual(plaintext);
    const message = encodeImagePayload({
      id: "11111111-1111-4111-8111-111111111111",
      k: encrypted.key,
      n: encrypted.nonce,
      mime: encrypted.mime,
      bytes: encrypted.ciphertext.byteLength,
    });
    expect(message.includes(Buffer.from(plaintext).toString("base64"))).toBe(false);
    expect(parseChatPayload(message).type).toBe("image");
  });

  it("round-trips video and voice ciphertext", async () => {
    const video = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const sealedVideo = await encryptVideoBytes(video, "video/mp4", 3);
    expect(Buffer.from(sealedVideo.ciphertext).includes(Buffer.from(video))).toBe(false);
    expect(await bytesOf(await decryptVideoBytes(sealedVideo.ciphertext, sealedVideo.key, sealedVideo.nonce, sealedVideo.mime))).toEqual(video);

    const voice = new Uint8Array([9, 8, 7, 6, 5, 4]);
    const sealedVoice = await encryptVoiceNoteBytes(voice, "audio/mp4", 1.5);
    expect(Buffer.from(sealedVoice.ciphertext).includes(Buffer.from(voice))).toBe(false);
    expect(await bytesOf(await decryptVoiceNoteBytes(sealedVoice.ciphertext, sealedVoice.key, sealedVoice.nonce, sealedVoice.mime))).toEqual(voice);
  });

  it("keeps a call log as an encrypted chat payload older clients can ignore as text", () => {
    const encoded = encodeCallPayload({
      callId: "e8cfa520-3e79-40db-9d85-497a1bdc9917",
      mode: "audio",
      outcome: "completed",
      durationSeconds: 75,
      at: "2026-11-27T15:04:00.000Z",
    });
    const parsed = parseChatPayload(encoded);
    expect(parsed).toMatchObject({ type: "call", outcome: "completed", durationSeconds: 75 });
    expect(parseChatPayload("PM1CALL:{")).toEqual({ type: "text", text: "" });
  });
});
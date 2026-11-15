import { describe, expect, it } from "vitest";
import {
  decryptVoiceNoteBytes,
  encryptVoiceNoteBytes,
  resampleMonoAudio,
  validateVoiceNoteDuration,
} from "./voice-note";

describe("voice-note audio utilities", () => {
  it("downmixes and resamples audio to 16 kHz", () => {
    const left = Float32Array.from([1, 0, -1, 0]);
    const right = Float32Array.from([0, 1, 0, -1]);
    const result = resampleMonoAudio([left, right], 8_000);
    expect(result.length).toBe(8);
    expect(result).toEqual(
      Float32Array.from([0.5, 0.5, 0.5, 0, -0.5, -0.5, -0.5, -0.5]),
    );
  });

  it("rejects invalid durations and empty or oversized audio", async () => {
    expect(validateVoiceNoteDuration(1)).toBeUndefined();
    expect(() => validateVoiceNoteDuration(0)).toThrow("invalid duration");
    await expect(
      encryptVoiceNoteBytes(new Uint8Array(), "audio/webm", 1),
    ).rejects.toThrow("storage limit");
    await expect(
      encryptVoiceNoteBytes(new Uint8Array(6_500_000), "audio/webm", 1),
    ).rejects.toThrow("storage limit");
  });

  it("encrypts voice notes before storage and decrypts them for playback", async () => {
    const original = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0x01, 0x02]);
    const encrypted = await encryptVoiceNoteBytes(original, "audio/webm", 2.5);
    expect(encrypted.ciphertext).not.toEqual(original);
    const decrypted = await decryptVoiceNoteBytes(
      encrypted.ciphertext,
      encrypted.key,
      encrypted.nonce,
      encrypted.mime,
    );
    expect(decrypted.type).toBe("audio/webm");
    expect(new Uint8Array(await decrypted.arrayBuffer())).toEqual(original);
  });
});

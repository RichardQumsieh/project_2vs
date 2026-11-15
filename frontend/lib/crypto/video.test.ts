import { describe, expect, it } from "vitest";
import {
  decryptVideoBytes,
  encryptVideoBytes,
  getCompressedVideoDimensions,
  maxVideoDurationSeconds,
  validateCompressedVideoDuration,
  validateVideoDuration,
} from "./video";

describe("video compression and encryption", () => {
  it("scales video down without changing its aspect ratio", () => {
    expect(getCompressedVideoDimensions(1920, 1080)).toEqual({
      width: 852,
      height: 480,
    });
    expect(getCompressedVideoDimensions(640, 480)).toEqual({
      width: 640,
      height: 480,
    });
    expect(getCompressedVideoDimensions(1080, 1920)).toEqual({
      width: 270,
      height: 480,
    });
  });

  it("rejects invalid dimensions and videos longer than 75 seconds", () => {
    expect(validateVideoDuration(maxVideoDurationSeconds)).toBeUndefined();
    expect(() => validateVideoDuration(75.01)).toThrow(
      "Videos must be 75 seconds or shorter.",
    );
    expect(() => validateVideoDuration(Number.NaN)).toThrow(
      "This video has an invalid duration.",
    );
    expect(() => getCompressedVideoDimensions(0, 1080)).toThrow(
      "The video has invalid dimensions.",
    );
  });

  it("rejects compressed output with a materially different duration", () => {
    expect(validateCompressedVideoDuration(45, 45.8)).toBeUndefined();
    expect(() => validateCompressedVideoDuration(45, 147)).toThrow(
      "Video compression changed the clip duration.",
    );
  });

  it("decrypts compressed video bytes back to the original", async () => {
    const original = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
    const encrypted = await encryptVideoBytes(original, "video/webm", 12.5);
    const blob = await decryptVideoBytes(
      encrypted.ciphertext,
      encrypted.key,
      encrypted.nonce,
      encrypted.mime,
    );
    expect(blob.type).toBe("video/webm");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(original);
  });
});

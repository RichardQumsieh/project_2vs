import { describe, expect, it } from "vitest";
import { encryptPhotoBytes } from "../../frontend/lib/crypto/media";
import { encryptVideoBytes } from "../../frontend/lib/crypto/video";
import { encryptVoiceNoteBytes } from "../../frontend/lib/crypto/voice-note";
import {
  cacheExpiry,
  decodeCacheBytes,
  decryptAesGcmBytes,
  encodeCacheBytes,
  extensionForMime,
  isCacheExpired,
  sanitizeCacheFileName,
} from "./media-bytes";

describe("media byte helpers", () => {
  it("round-trips cache encoding without constructing a blob", () => {
    const bytes = new Uint8Array([0, 1, 255, 16, 32, 64]);
    expect(decodeCacheBytes(encodeCacheBytes(bytes))).toEqual(bytes);
    expect(sanitizeCacheFileName("../a photo!.png")).toBe("a_photo_.png");
    expect(sanitizeCacheFileName("...")).toBe("media.bin");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("audio/mp4")).toBe("m4a");
  });

  it("expires decrypted cache files on a ttl and not before", () => {
    const now = 1_700_000_000_000;
    const expires = cacheExpiry(now);
    expect(isCacheExpired(expires, expires - 1)).toBe(false);
    expect(isCacheExpired(expires, expires)).toBe(true);
  });

  it("decrypts photo, video, and voice ciphertext to bytes", async () => {
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0x11, 0x22, 0x33, 0xd9]);
    const sealedPhoto = await encryptPhotoBytes(photo, "image/jpeg");
    expect(Buffer.from(sealedPhoto.ciphertext).includes(Buffer.from(photo))).toBe(false);
    expect(await decryptAesGcmBytes(sealedPhoto.ciphertext, sealedPhoto.key, sealedPhoto.nonce)).toEqual(photo);

    const video = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const sealedVideo = await encryptVideoBytes(video, "video/mp4", 2);
    expect(await decryptAesGcmBytes(sealedVideo.ciphertext, sealedVideo.key, sealedVideo.nonce)).toEqual(video);

    const voice = new Uint8Array([9, 8, 7, 6, 5]);
    const sealedVoice = await encryptVoiceNoteBytes(voice, "audio/mp4", 1);
    expect(await decryptAesGcmBytes(sealedVoice.ciphertext, sealedVoice.key, sealedVoice.nonce)).toEqual(voice);
  });
});

import { describe, expect, it } from "vitest";
import { maxEncryptedVideoBytes, maxVideoDurationSeconds } from "../../frontend/lib/crypto/video";
import { maxPhotoBytes } from "../../frontend/lib/crypto/media";
import {
  validateNativePhotoAsset,
  validateNativeVideoAsset,
  type NativeMediaAsset,
} from "./prepare-chat-media-validate";

function asset(partial: Partial<NativeMediaAsset> & Pick<NativeMediaAsset, "bytes" | "mime">): NativeMediaAsset {
  return {
    uri: "file:///tmp/media",
    fileName: "media.bin",
    ...partial,
  };
}

describe("validateNativePhotoAsset", () => {
  it("accepts a JPEG within the size limit", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(() => validateNativePhotoAsset(asset({ bytes, mime: "image/jpeg" }))).not.toThrow();
  });

  it("rejects oversized photos", () => {
    const bytes = new Uint8Array(maxPhotoBytes + 1);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    expect(() => validateNativePhotoAsset(asset({ bytes, mime: "image/jpeg" }))).toThrow(
      /6 MB or smaller/,
    );
  });
});

describe("validateNativeVideoAsset", () => {
  it("accepts a short mp4 under the encrypted size budget", () => {
    expect(() =>
      validateNativeVideoAsset(
        asset({
          bytes: new Uint8Array(1024),
          mime: "video/mp4",
          duration: 12,
        }),
      ),
    ).not.toThrow();
  });

  it("rejects videos longer than the shared duration cap", () => {
    expect(() =>
      validateNativeVideoAsset(
        asset({
          bytes: new Uint8Array(1024),
          mime: "video/mp4",
          duration: maxVideoDurationSeconds + 1,
        }),
      ),
    ).toThrow(/75 seconds/);
  });

  it("rejects videos that cannot fit the encrypted storage limit", () => {
    expect(() =>
      validateNativeVideoAsset(
        asset({
          bytes: new Uint8Array(maxEncryptedVideoBytes),
          mime: "video/mp4",
          duration: 10,
        }),
      ),
    ).toThrow(/too large|MB or smaller/i);
  });
});

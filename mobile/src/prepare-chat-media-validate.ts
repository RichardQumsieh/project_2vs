import { maxPhotoBytes, type AllowedPhotoMime } from "../../frontend/lib/crypto/media";
import {
  maxEncryptedVideoBytes,
  maxVideoDurationSeconds,
  validateVideoDuration,
} from "../../frontend/lib/crypto/video";
import type { EncryptedFileAttachment } from "../../frontend/lib/crypto/file-attachment";

export type NativeMediaAsset = {
  uri: string;
  bytes: Uint8Array;
  mime: string;
  fileName?: string;
  width?: number;
  height?: number;
  duration?: number;
};

export type PreparedNativeChatMedia =
  | { kind: "photo"; asset: NativeMediaAsset; caption: string }
  | { kind: "album"; assets: NativeMediaAsset[]; caption: string }
  | { kind: "video"; asset: NativeMediaAsset; caption: string }
  | { kind: "voice"; asset: NativeMediaAsset; duration: number; caption: string; wave?: number[] }
  | { kind: "file"; attachment: EncryptedFileAttachment; caption: string };

export function sniffPhotoMime(bytes: Uint8Array, hinted?: string): AllowedPhotoMime {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (hinted === "image/jpeg" || hinted === "image/png" || hinted === "image/webp" || hinted === "image/gif") {
    return hinted;
  }
  throw new Error("Use a JPEG, PNG, WebP, or GIF photo.");
}

export function validateNativePhotoAsset(asset: NativeMediaAsset) {
  if (asset.bytes.byteLength === 0 || asset.bytes.byteLength > maxPhotoBytes) {
    throw new Error("Each photo must be 6 MB or smaller.");
  }
  sniffPhotoMime(asset.bytes, asset.mime);
}

export function validateNativeVideoAsset(asset: NativeMediaAsset) {
  const duration = asset.duration ?? 0;
  validateVideoDuration(duration);
  if (asset.bytes.byteLength === 0 || asset.bytes.byteLength + 16 > maxEncryptedVideoBytes) {
    throw new Error(
      `Videos must be ${Math.floor(maxEncryptedVideoBytes / 1_000_000)} MB or smaller after capture (max ${maxVideoDurationSeconds}s). Try a shorter clip.`,
    );
  }
  if (!asset.mime.startsWith("video/")) {
    throw new Error("Choose a supported video file.");
  }
}

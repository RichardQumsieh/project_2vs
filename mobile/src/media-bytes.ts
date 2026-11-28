import { asBufferSource, b64ToBytes, bytesToB64 } from "../../frontend/lib/crypto/bytes";

export const decryptedCacheTtlMs = 30 * 60 * 1000;

export function cacheExpiry(now: number, ttl = decryptedCacheTtlMs) {
  return now + ttl;
}

export function isCacheExpired(expiresAt: number, now: number) {
  return Number.isFinite(expiresAt) && now >= expiresAt;
}

export function encodeCacheBytes(bytes: Uint8Array): string {
  return bytesToB64(bytes);
}

export function decodeCacheBytes(value: string): Uint8Array {
  return b64ToBytes(value);
}

export function sanitizeCacheFileName(name: string) {
  const base = name.split(/[/\\]/).pop() ?? name;
  const cleaned = base.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(0, 96);
  return cleaned || "media.bin";
}

export function extensionForMime(mime: string) {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/webm":
      return "webm";
    default:
      return "bin";
  }
}

/** AES-GCM decrypt that returns bytes. Mobile must not wrap these in Blob. */
export async function decryptAesGcmBytes(
  ciphertext: Uint8Array,
  keyB64: string,
  nonceB64: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(b64ToBytes(keyB64)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(b64ToBytes(nonceB64)) },
    key,
    asBufferSource(ciphertext),
  );
  return new Uint8Array(plaintext);
}

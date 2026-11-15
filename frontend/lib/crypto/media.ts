import { asBufferSource, bytesToB64, b64ToBytes, randomBytes } from "./bytes";

export const maxPhotoBytes = 6_000_000;
export const allowedPhotoMimes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedPhotoMime = (typeof allowedPhotoMimes)[number];

export type EncryptedPhoto = {
  ciphertext: Uint8Array;
  key: string;
  nonce: string;
  mime: AllowedPhotoMime;
  width?: number;
  height?: number;
};

function sniffPhotoMime(bytes: Uint8Array): AllowedPhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
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
  return null;
}

async function photoDimensions(bytes: Uint8Array, mime: AllowedPhotoMime) {
  const blob = new Blob([asBufferSource(bytes)], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();
  return { width, height };
}

export async function encryptPhotoBytes(
  bytes: Uint8Array,
  mime: AllowedPhotoMime,
): Promise<EncryptedPhoto> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(nonce) },
      key,
      asBufferSource(bytes),
    ),
  );
  const exported = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const dimensions = await photoDimensions(bytes, mime).catch(() => undefined);

  return {
    ciphertext,
    key: bytesToB64(exported),
    nonce: bytesToB64(nonce),
    mime,
    width: dimensions?.width,
    height: dimensions?.height,
  };
}

export async function encryptPhotoFile(file: File): Promise<EncryptedPhoto> {
  if (file.size > maxPhotoBytes) {
    throw new Error("Photos must be 6 MB or smaller.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffPhotoMime(bytes);
  if (!mime) {
    throw new Error("Use a JPEG, PNG, WebP, or GIF photo.");
  }

  return encryptPhotoBytes(bytes, mime);
}

export async function decryptPhotoBytes(
  ciphertext: Uint8Array,
  keyB64: string,
  nonceB64: string,
  mime: AllowedPhotoMime,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(b64ToBytes(keyB64)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(b64ToBytes(nonceB64)) },
      key,
      asBufferSource(ciphertext),
    ),
  );
  return new Blob([asBufferSource(plaintext)], { type: mime });
}

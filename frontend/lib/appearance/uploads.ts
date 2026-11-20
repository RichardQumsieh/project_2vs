export const MAX_UPLOAD_BYTES = 1_500_000;

export type UploadMime = "image/png" | "image/jpeg" | "image/webp";

export type StoredUpload = {
  id: string;
  userId: string;
  mime: UploadMime;
  bytes: Uint8Array;
  createdAt: string;
};

export type UploadRepository = {
  put(upload: StoredUpload): Promise<void>;
  get(userId: string, id: string): Promise<StoredUpload | null>;
  delete(userId: string, id: string): Promise<void>;
};

export function validateUpload(input: {
  mime: string;
  bytes: Uint8Array;
}): { ok: true; mime: UploadMime } | { ok: false; reason: "type" | "size" } {
  if (input.bytes.byteLength < 16 || input.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "size" };
  }
  const sniffed = sniffImage(input.bytes);
  if (!sniffed || sniffed !== input.mime) return { ok: false, reason: "type" };
  return { ok: true, mime: sniffed };
}

export function sniffImage(bytes: Uint8Array): UploadMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
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

export function memoryUploads(): UploadRepository {
  const rows = new Map<string, StoredUpload>();
  const key = (userId: string, id: string) => `${userId}:${id}`;
  return {
    async put(upload) {
      rows.set(key(upload.userId, upload.id), {
        ...upload,
        bytes: new Uint8Array(upload.bytes),
      });
    },
    async get(userId, id) {
      const found = rows.get(key(userId, id));
      return found ? { ...found, bytes: new Uint8Array(found.bytes) } : null;
    },
    async delete(userId, id) {
      rows.delete(key(userId, id));
    },
  };
}

export function uploadObjectUrl(upload: StoredUpload): string {
  const blob = new Blob([Uint8Array.from(upload.bytes)], { type: upload.mime });
  return URL.createObjectURL(blob);
}

import { openDB, type DBSchema } from "idb";
import { sanitizeUserId } from "./store";
import type { StoredUpload, UploadMime, UploadRepository } from "./uploads";

interface AppearanceDb extends DBSchema {
  uploads: {
    key: string;
    value: {
      id: string;
      userId: string;
      mime: UploadMime;
      bytes: ArrayBuffer;
      createdAt: string;
    };
  };
}

function uploadKey(userId: string, id: string): string {
  return `${sanitizeUserId(userId)}:${id}`;
}

async function database() {
  return openDB<AppearanceDb>("sophia-appearance", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("uploads")) {
        db.createObjectStore("uploads");
      }
    },
  });
}

export function idbUploads(): UploadRepository {
  return {
    async put(upload) {
      const db = await database();
      const key = uploadKey(upload.userId, upload.id);
      const copy = new Uint8Array(upload.bytes.byteLength);
      copy.set(upload.bytes);
      await db.put("uploads", {
        id: upload.id,
        userId: sanitizeUserId(upload.userId),
        mime: upload.mime,
        bytes: copy.buffer,
        createdAt: upload.createdAt,
      }, key);
      const prefix = `${sanitizeUserId(upload.userId)}:`;
      const keys = await db.getAllKeys("uploads");
      const mine: Array<{ key: string; createdAt: string }> = [];
      for (const item of keys) {
        const key = String(item);
        if (!key.startsWith(prefix)) continue;
        const row = await db.get("uploads", key);
        if (row) mine.push({ key, createdAt: row.createdAt });
      }
      mine.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const extra = mine.slice(0, Math.max(0, mine.length - 3));
      await Promise.all(extra.map((item) => db.delete("uploads", item.key)));
    },
    async get(userId, id) {
      const db = await database();
      const row = await db.get("uploads", uploadKey(userId, id));
      if (!row) return null;
      return {
        id: row.id,
        userId: row.userId,
        mime: row.mime,
        bytes: new Uint8Array(row.bytes),
        createdAt: row.createdAt,
      };
    },
    async delete(userId, id) {
      const db = await database();
      await db.delete("uploads", uploadKey(userId, id));
    },
  };
}

export type { StoredUpload };

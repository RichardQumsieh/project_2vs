import { openDB, type DBSchema } from "idb";
import type { LocalMessage, PendingDirectSend, SessionRecord, VaultRecord } from "./crypto/types";

interface MessengerDB extends DBSchema {
  meta: {
    key: string;
    value: VaultRecord | string | CryptoKey | { nonce: string; ciphertext: string };
  };
  sessions: {
    key: string;
    value: SessionRecord;
  };
  groupSessions: {
    key: string;
    value: { nonce: string; ciphertext: string };
  };
  outbox: {
    key: string;
    value: PendingDirectSend;
  };
  messages: {
    key: string;
    value: LocalMessage;
    indexes: {
      "by-conversation": string;
      "by-conversation-createdAt": [string, string];
      "by-conversation-createdAt-id": [string, string, string];
    };
  };
}

const DB_NAME = "private-messenger";

export type { PendingDirectSend } from "./crypto/types";

export function sessionKey(
  conversationId: string,
  remoteDeviceId: string,
  direction: "incoming" | "outgoing" = "outgoing",
) {
  return `${conversationId}:${remoteDeviceId}:${direction}`;
}

export async function getDb() {
  return openDB<MessengerDB>(DB_NAME, 11, {
    upgrade(db, _oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta");
      }

      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions");
      }

      if (!db.objectStoreNames.contains("messages")) {
        const messages = db.createObjectStore("messages", {
          keyPath: "id",
        });

        messages.createIndex(
          "by-conversation",
          "conversationId",
        );
      }

      const messages = transaction.objectStore("messages");
      if (!messages.indexNames.contains("by-conversation-createdAt")) {
        messages.createIndex(
          "by-conversation-createdAt",
          ["conversationId", "createdAt"],
        );
      }
      if (!db.objectStoreNames.contains("groupSessions")) {
        db.createObjectStore("groupSessions");
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id" });
      }

      if (!messages.indexNames.contains("by-conversation-createdAt-id")) {
        messages.createIndex(
          "by-conversation-createdAt-id",
          ["conversationId", "createdAt", "id"],
        );
      }
    },
  });
}

function metaKey(userId: string, key: string) {
  return `${userId}:${key}`;
}

export async function saveSealedGroup(
  userId: string,
  conversationId: string,
  value: { nonce: string; ciphertext: string },
) {
  const db = await getDb();
  await db.put("groupSessions", value, `${userId}:${conversationId}`);
}

export async function loadSealedGroup(userId: string, conversationId: string) {
  const db = await getDb();
  return db.get("groupSessions", `${userId}:${conversationId}`);
}

export async function saveVault(record: VaultRecord, userId?: string) {
  const db = await getDb();
  const metaUserId = userId ?? record.userId ?? "legacy";
  await db.put("meta", record, metaKey(metaUserId, "vault"));
}

export async function loadVault(userId?: string) {
  const db = await getDb();
  const targetUserId = userId ?? "legacy";
  return (await db.get("meta", metaKey(targetUserId, "vault"))) as VaultRecord | undefined;
}

export async function saveAccountArchiveCache(
  userId: string,
  value: { nonce: string; ciphertext: string },
) {
  const db = await getDb();
  await db.put("meta", value, metaKey(userId, "accountArchiveKey"));
}

export async function loadAccountArchiveCache(userId: string) {
  const db = await getDb();
  return (await db.get("meta", metaKey(userId, "accountArchiveKey"))) as
    | { nonce: string; ciphertext: string }
    | undefined;
}

export async function savePendingArchiveRecoveryCode(
  userId: string,
  value: { publicKey: string; nonce: string; ciphertext: string },
) {
  const db = await getDb();
  await db.put("meta", value, metaKey(userId, "pendingArchiveRecoveryCode"));
}

export async function loadPendingArchiveRecoveryCode(userId: string) {
  const db = await getDb();
  return (await db.get("meta", metaKey(userId, "pendingArchiveRecoveryCode"))) as
    | { publicKey: string; nonce: string; ciphertext: string }
    | undefined;
}

export async function deletePendingArchiveRecoveryCode(userId: string) {
  const db = await getDb();
  await db.delete("meta", metaKey(userId, "pendingArchiveRecoveryCode"));
}

export async function saveRememberedVaultKey(userId: string, key: CryptoKey) {
  const db = await getDb();
  await db.put("meta", key, metaKey(userId, "rememberedVaultKey"));
}

export async function loadRememberedVaultKey(userId: string) {
  const db = await getDb();
  const value = await db.get("meta", metaKey(userId, "rememberedVaultKey"));
  if (
    typeof CryptoKey === "undefined" ||
    !(value instanceof CryptoKey) ||
    value.type !== "secret" ||
    value.algorithm.name !== "AES-GCM" ||
    value.extractable ||
    !value.usages.includes("decrypt")
  ) {
    return undefined;
  }
  return value;
}

export async function deleteRememberedVaultKey(userId: string) {
  const db = await getDb();
  await db.delete("meta", metaKey(userId, "rememberedVaultKey"));
}

export async function saveDeviceId(deviceId: string, userId?: string) {
  const db = await getDb();
  const targetUserId = userId ?? "legacy";
  await db.put("meta", deviceId, metaKey(targetUserId, "deviceId"));
}

export async function loadDeviceId(userId?: string) {
  const db = await getDb();
  const targetUserId = userId ?? "legacy";
  return (await db.get("meta", metaKey(targetUserId, "deviceId"))) as string | undefined;
}

export async function saveSession(
  record: SessionRecord,
  direction: "incoming" | "outgoing" = record.direction ?? "outgoing",
) {
  const db = await getDb();
  await db.put("sessions", { ...record, direction }, sessionKey(record.conversationId, record.remoteDeviceId, direction));
}

export async function saveSessions(records: SessionRecord[]) {
  if (records.length === 0) return;
  const db = await getDb();
  const transaction = db.transaction("sessions", "readwrite");
  await Promise.all(
    records.map((record) =>
      transaction.store.put(
        { ...record, direction: record.direction },
        sessionKey(record.conversationId, record.remoteDeviceId, record.direction),
      ),
    ),
  );
  await transaction.done;
}

export async function loadSession(
  conversationId: string,
  remoteDeviceId: string,
  direction: "incoming" | "outgoing" = "outgoing",
) {
  const db = await getDb();
  return db.get("sessions", sessionKey(conversationId, remoteDeviceId, direction));
}

export async function deleteSession(
  conversationId: string,
  remoteDeviceId: string,
  direction: "incoming" | "outgoing",
) {
  const db = await getDb();
  await db.delete("sessions", sessionKey(conversationId, remoteDeviceId, direction));
}

export async function clearSessions() {
  const db = await getDb();
  await db.clear("sessions");
}

export async function listAllSessions() {
  const db = await getDb();
  return db.getAll("sessions");
}

export async function saveLocalMessage(message: LocalMessage) {
  const db = await getDb();
  await db.put("messages", message);
}

export async function deleteLocalMessages(
  conversationId: string,
  logicalMessageId: string,
  messageRecordIds: string[] = [],
) {
  const db = await getDb();
  const recordIds = new Set(messageRecordIds);
  const removed: LocalMessage[] = [];
  const transaction = db.transaction("messages", "readwrite");
  let cursor = await transaction.store.index("by-conversation").openCursor(conversationId);
  while (cursor) {
    const message = cursor.value;
    if (
      (message.logicalMessageId ?? message.id) === logicalMessageId ||
      recordIds.has(message.id)
    ) {
      removed.push(message);
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await transaction.done;
  return removed;
}

export async function listAllLocalMessages() {
  const db = await getDb();
  return db.getAll("messages");
}

export async function getLocalMessage(id: string) {
  const db = await getDb();
  return db.get("messages", id);
}

export async function listLocalMessages(
  conversationId: string,
  limit: number,
  before?: { createdAt: string; id: string },
) {
  const db = await getDb();
  const range = before
    ? IDBKeyRange.bound(
        [conversationId, "", ""],
        [conversationId, before.createdAt, before.id],
        false,
        true,
      )
    : IDBKeyRange.bound(
        [conversationId, "", ""],
        [conversationId, "\uffff", "\uffff"],
      );
  const messages: LocalMessage[] = [];
  let cursor = await db
    .transaction("messages")
    .store
    .index("by-conversation-createdAt-id")
    .openCursor(range, "prev");

  while (cursor && messages.length < limit) {
    messages.push(cursor.value);
    cursor = await cursor.continue();
  }

  return messages.reverse();
}

export async function savePendingDirectSend(send: PendingDirectSend) {
  const db = await getDb();
  await db.put("outbox", send);
}

export async function listPendingDirectSends(conversationId?: string) {
  const db = await getDb();
  const sends = await db.getAll("outbox");
  return conversationId ? sends.filter((send) => send.conversationId === conversationId) : sends;
}

export async function deletePendingDirectSend(id: string) {
  const db = await getDb();
  await db.delete("outbox", id);
}

export async function loadWireCursor(conversationId: string) {
  const db = await getDb();
  return db.get("meta", metaKey(conversationId, "wireCursor")) as Promise<string | undefined>;
}

export async function saveWireCursor(conversationId: string, messageId: string) {
  const db = await getDb();
  await db.put("meta", messageId, metaKey(conversationId, "wireCursor"));
}

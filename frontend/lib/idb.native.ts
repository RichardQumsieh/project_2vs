import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { LocalMessage, PendingDirectSend, SessionRecord, VaultRecord } from "./crypto/types";

export type { PendingDirectSend } from "./crypto/types";

const DATABASE_NAME = "sophia-chat.db";
const DATABASE_KEY_NAME = "sophia_native_chat_db_key_v1";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function sessionKey(
  conversationId: string,
  remoteDeviceId: string,
  direction: "incoming" | "outgoing" = "outgoing",
) {
  return `${conversationId}:${remoteDeviceId}:${direction}`;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function databaseKey() {
  let key = await SecureStore.getItemAsync(DATABASE_KEY_NAME);
  if (key) return key;

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  key = bytesToHex(bytes);
  await SecureStore.setItemAsync(DATABASE_KEY_NAME, key);
  return key;
}

export async function getDb() {
  databasePromise ??= (async () => {
    const key = await databaseKey();
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    // The key is generated locally and hex encoded, so it cannot change the SQL statement.
    await db.execAsync(`PRAGMA key = "x'${key}'"; PRAGMA cipher_memory_security = ON;`);
    await db.execAsync(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_by_conversation_time
        ON messages (conversation_id, created_at, id);
      CREATE TABLE IF NOT EXISTS group_sessions (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS direct_outbox (id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL, created_at TEXT NOT NULL, value TEXT NOT NULL);
    `);
    return db;
  })();
  return databasePromise;
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
  await db.runAsync(
    "INSERT INTO group_sessions (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    `${userId}:${conversationId}`,
    JSON.stringify(value),
  );
}

export async function loadSealedGroup(userId: string, conversationId: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM group_sessions WHERE key = ?",
    `${userId}:${conversationId}`,
  );
  return row ? JSON.parse(row.value) as { nonce: string; ciphertext: string } : undefined;
}

export async function saveVault(record: VaultRecord, userId?: string) {
  const db = await getDb();
  const accountId = userId ?? record.userId ?? "legacy";
  await db.runAsync(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    metaKey(accountId, "vault"), JSON.stringify(record),
  );
}

export async function loadVault(userId?: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?", metaKey(userId ?? "legacy", "vault"),
  );
  return row ? JSON.parse(row.value) as VaultRecord : undefined;
}

export async function saveAccountArchiveCache(userId: string, value: { nonce: string; ciphertext: string }) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    metaKey(userId, "accountArchiveKey"), JSON.stringify(value),
  );
}

export async function loadAccountArchiveCache(userId: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?", metaKey(userId, "accountArchiveKey"),
  );
  return row ? JSON.parse(row.value) as { nonce: string; ciphertext: string } : undefined;
}

export async function savePendingArchiveRecoveryCode(
  userId: string,
  value: { publicKey: string; nonce: string; ciphertext: string },
) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    metaKey(userId, "pendingArchiveRecoveryCode"), JSON.stringify(value),
  );
}

export async function loadPendingArchiveRecoveryCode(userId: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?", metaKey(userId, "pendingArchiveRecoveryCode"),
  );
  return row ? JSON.parse(row.value) as { publicKey: string; nonce: string; ciphertext: string } : undefined;
}

export async function deletePendingArchiveRecoveryCode(userId: string) {
  const db = await getDb();
  await db.runAsync("DELETE FROM meta WHERE key = ?", metaKey(userId, "pendingArchiveRecoveryCode"));
}

// The non-extractable WebCrypto key cannot be serialized into SQLite. Native unlock therefore
// asks for the vault password each time instead of keeping a reusable key in app storage.
export async function saveRememberedVaultKey(_userId: string, _key: CryptoKey) {}
export async function loadRememberedVaultKey(_userId: string) { return undefined; }
export async function deleteRememberedVaultKey(_userId: string) {}

export async function saveDeviceId(deviceId: string, userId?: string) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    metaKey(userId ?? "legacy", "deviceId"), JSON.stringify(deviceId),
  );
}

export async function loadDeviceId(userId?: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?", metaKey(userId ?? "legacy", "deviceId"),
  );
  return row ? JSON.parse(row.value) as string : undefined;
}

export async function saveSession(
  record: SessionRecord,
  direction: "incoming" | "outgoing" = record.direction ?? "outgoing",
) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO sessions (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    sessionKey(record.conversationId, record.remoteDeviceId, direction),
    JSON.stringify({ ...record, direction }),
  );
}

export async function saveSessions(records: SessionRecord[]) {
  if (!records.length) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const record of records) {
      const direction = record.direction ?? "outgoing";
      await db.runAsync(
        "INSERT INTO sessions (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        sessionKey(record.conversationId, record.remoteDeviceId, direction),
        JSON.stringify({ ...record, direction }),
      );
    }
  });
}

export async function loadSession(
  conversationId: string,
  remoteDeviceId: string,
  direction: "incoming" | "outgoing" = "outgoing",
) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sessions WHERE key = ?", sessionKey(conversationId, remoteDeviceId, direction),
  );
  return row ? JSON.parse(row.value) as SessionRecord : undefined;
}

export async function deleteSession(conversationId: string, remoteDeviceId: string, direction: "incoming" | "outgoing") {
  const db = await getDb();
  await db.runAsync("DELETE FROM sessions WHERE key = ?", sessionKey(conversationId, remoteDeviceId, direction));
}

export async function clearSessions() {
  const db = await getDb();
  await db.runAsync("DELETE FROM sessions");
}

export async function listAllSessions() {
  const db = await getDb();
  const rows = await db.getAllAsync<{ value: string }>("SELECT value FROM sessions");
  return rows.map((row) => JSON.parse(row.value) as SessionRecord);
}

export async function saveLocalMessage(message: LocalMessage) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO messages (id, conversation_id, created_at, value) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, created_at = excluded.created_at, value = excluded.value",
    message.id, message.conversationId, message.createdAt, JSON.stringify(message),
  );
}

export async function deleteLocalMessages(conversationId: string, logicalMessageId: string, messageRecordIds: string[] = []) {
  const db = await getDb();
  const rows = await db.getAllAsync<{ value: string }>(
    "SELECT value FROM messages WHERE conversation_id = ?", conversationId,
  );
  const recordIds = new Set(messageRecordIds);
  const removed = rows.map((row) => JSON.parse(row.value) as LocalMessage).filter((message) =>
    (message.logicalMessageId ?? message.id) === logicalMessageId || recordIds.has(message.id),
  );
  if (!removed.length) return removed;
  await db.withTransactionAsync(async () => {
    for (const message of removed) await db.runAsync("DELETE FROM messages WHERE id = ?", message.id);
  });
  return removed;
}

export async function listAllLocalMessages() {
  const db = await getDb();
  const rows = await db.getAllAsync<{ value: string }>("SELECT value FROM messages");
  return rows.map((row) => JSON.parse(row.value) as LocalMessage);
}

export async function getLocalMessage(id: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM messages WHERE id = ?", id);
  return row ? JSON.parse(row.value) as LocalMessage : undefined;
}

export async function listLocalMessages(conversationId: string, limit: number, before?: { createdAt: string; id: string }) {
  const db = await getDb();
  const rows = before
    ? await db.getAllAsync<{ value: string }>(
      "SELECT value FROM messages WHERE conversation_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
      conversationId, before.createdAt, before.createdAt, before.id, limit,
    )
    : await db.getAllAsync<{ value: string }>(
      "SELECT value FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
      conversationId, limit,
    );
  return rows.map((row) => JSON.parse(row.value) as LocalMessage).reverse();
}

export async function savePendingDirectSend(send: PendingDirectSend) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO direct_outbox (id, conversation_id, created_at, value) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, created_at = excluded.created_at, value = excluded.value",
    send.id, send.conversationId, send.createdAt, JSON.stringify(send),
  );
}

export async function listPendingDirectSends(conversationId?: string) {
  const db = await getDb();
  const rows = conversationId
    ? await db.getAllAsync<{ value: string }>("SELECT value FROM direct_outbox WHERE conversation_id = ? ORDER BY created_at ASC", conversationId)
    : await db.getAllAsync<{ value: string }>("SELECT value FROM direct_outbox ORDER BY created_at ASC");
  return rows.map((row) => JSON.parse(row.value) as PendingDirectSend);
}

export async function deletePendingDirectSend(id: string) {
  const db = await getDb();
  await db.runAsync("DELETE FROM direct_outbox WHERE id = ?", id);
}

export async function loadWireCursor(conversationId: string) {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?", metaKey(conversationId, "wireCursor"),
  );
  return row ? JSON.parse(row.value) as string : undefined;
}

export async function saveWireCursor(conversationId: string, messageId: string) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    metaKey(conversationId, "wireCursor"), JSON.stringify(messageId),
  );
}

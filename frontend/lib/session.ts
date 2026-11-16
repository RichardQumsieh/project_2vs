import {
  createIdentityMaterial,
  devicePayload,
} from "./crypto/identity";

import {
  ratchetDecrypt,
} from "./crypto/ratchet";
import { encryptForDevice } from "./crypto/multi-device";

import type {
  IdentityMaterial,
  LocalMessage,
  StoredSession,
  VaultRecord,
  WireMessage,
} from "./crypto/types";

import {
  acceptSession,
} from "./crypto/x3dh";
import type { EncryptedDeviceEnvelope } from "./crypto/multi-device";

import {
  openVaultWithKey,
  sealVault,
} from "./crypto/vault";
import { b64ToBytes } from "./crypto/bytes";
import { deriveVaultKey } from "./crypto/kdf";
import {
  decryptDeviceBackup,
  encryptDeviceBackup,
} from "./crypto/device-backup";
import {
  archivePasswordWrapRecord,
  createAccountArchiveKey,
  decryptArchiveMessage,
  encryptArchiveMessage,
  recoveryCodeDigest,
  unlockAccountArchiveKey,
  createAccountArchiveKeyRecord,
  encryptAccountArchiveDriveBackup,
  type AccountArchiveMaterial,
  type AccountArchiveDriveBackup,
} from "./crypto/account-archive";

import {
  getLocalMessage,
  clearSessions,
  deleteSession,
  listAllLocalMessages,
  listAllSessions,
  listLocalMessages,
  loadDeviceId,
  loadAccountArchiveCache,
  loadPendingArchiveRecoveryCode,
  loadRememberedVaultKey,
  loadSession,
  loadVault,
  deleteRememberedVaultKey,
  saveDeviceId,
  saveAccountArchiveCache,
  savePendingArchiveRecoveryCode,
  deletePendingArchiveRecoveryCode,
  deleteLocalMessages,
  saveLocalMessage,
  saveRememberedVaultKey,
  saveSession,
  saveSessions,
  saveVault,
  sessionKey,
} from "./idb";

import { api, type EncryptedBackupRecord } from "./api";

let identity:
  IdentityMaterial | null = null;

let deviceId:
  string | null = null;

let identityUserId:
  string | null = null;

let vaultKey: CryptoKey | null = null;
let accountArchiveKey: AccountArchiveMaterial | null = null;
let pendingArchiveRecoveryCodeToDisplay: string | null = null;

function publishPendingArchiveRecoveryCode(value: string | null) {
  pendingArchiveRecoveryCodeToDisplay = value;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("private-messenger-archive-recovery-code"));
  }
}
const pendingRecoveryRecords = new Map<
  "message" | "session",
  Map<string, {
    value: unknown;
    conversationId?: string;
    createdAt?: string;
  }>
>();
let recoveryBackupError: string | null = null;
let recoveryFlushQueue = Promise.resolve();

export function getRecoveryBackupError() {
  return recoveryBackupError;
}

function reportRecoveryBackupError(error: unknown) {
  recoveryBackupError = error instanceof Error
    ? error.message
    : "Could not save this device's encrypted recovery backup.";
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("private-messenger-recovery-backup"));
  }
}

function recoveryAdditionalData(
  kind: "message" | "session",
  recordId: string,
) {
  if (!identityUserId || !deviceId) throw new Error("Device is locked");
  return `${identityUserId}:${deviceId}:${kind}:${recordId}`;
}

function queueRecoveryRecord(
  kind: "message" | "session",
  recordId: string,
  value: unknown,
  metadata: { conversationId?: string; createdAt?: string } = {},
) {
  if (
    kind === "message" &&
    metadata.conversationId &&
    isMessageDeleted(metadata.conversationId, recordId)
  ) {
    return;
  }
  const records = pendingRecoveryRecords.get(kind) ?? new Map();
  records.set(recordId, { value, ...metadata });
  pendingRecoveryRecords.set(kind, records);
}

async function encryptRecoveryRecord(
  kind: "message" | "session",
  recordId: string,
  record: { value: unknown; conversationId?: string; createdAt?: string },
): Promise<EncryptedBackupRecord> {
  if (!vaultKey) throw new Error("The encrypted recovery key is unavailable.");
  const encrypted = await encryptDeviceBackup(
    vaultKey,
    recoveryAdditionalData(kind, recordId).toString(),
    record.value,
  );
  return {
    recordId,
    ...(record.conversationId ? { conversationId: record.conversationId } : {}),
    ...(record.createdAt ? { createdAt: record.createdAt } : {}),
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
  };
}

async function uploadRecoveryRecords(
  kind: "message" | "session",
  records: EncryptedBackupRecord[],
) {
  if (!deviceId) throw new Error("Device is locked");
  let batch: EncryptedBackupRecord[] = [];
  let batchSize = 0;
  for (const record of records) {
    const recordSize = record.ciphertext.length + record.nonce.length + record.recordId.length + 256;
    if (batch.length > 0 && (batch.length >= 100 || batchSize + recordSize > 750 * 1024)) {
      await api.saveRecoveryRecords(deviceId, kind, batch);
      batch = [];
      batchSize = 0;
    }
    batch.push(record);
    batchSize += recordSize;
  }
  if (batch.length > 0) {
    await api.saveRecoveryRecords(deviceId, kind, batch);
  }
}

async function decryptRecoveryRecord<T>(
  kind: "message" | "session",
  record: EncryptedBackupRecord,
  key: CryptoKey,
  userId: string,
  targetDeviceId: string,
): Promise<T> {
  return decryptDeviceBackup<T>(
    key,
    `${userId}:${targetDeviceId}:${kind}:${record.recordId}`,
    record,
  );
}

async function flushRecoveryRecords() {
  const result = recoveryFlushQueue.then(flushRecoveryRecordsLocked);
  recoveryFlushQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function flushRecoveryRecordsLocked() {
  if (!deviceId || !vaultKey) return;
  try {
    for (const kind of ["message", "session"] as const) {
      const queued = pendingRecoveryRecords.get(kind);
      if (!queued?.size) continue;
      const pending = [...queued.entries()];
      const records: EncryptedBackupRecord[] = [];
      for (const [recordId, record] of pending) {
        if (
          kind === "message" &&
          record.conversationId &&
          isMessageDeleted(record.conversationId, recordId)
        ) {
          queued.delete(recordId);
          continue;
        }
        records.push(await encryptRecoveryRecord(kind, recordId, record));
      }
      if (records.length === 0) continue;
      await uploadRecoveryRecords(kind, records);
      for (const [recordId, record] of pending) {
        if (queued.get(recordId) === record) queued.delete(recordId);
      }
    }
    recoveryBackupError = null;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("private-messenger-recovery-backup"));
    }
  } catch (error) {
    reportRecoveryBackupError(error);
  }
}

async function restoreRecoveryRecords(
  targetDeviceId: string,
  key: CryptoKey,
  userId: string,
) {
  for (const kind of ["message", "session"] as const) {
    let after: string | undefined;
    while (true) {
      const page = await api.recoveryRecords(targetDeviceId, kind, after);
      if (page.records.length === 0) break;
      for (const backup of page.records) {
        const encrypted: EncryptedBackupRecord = {
          recordId: backup.recordId,
          ...(backup.conversationId ? { conversationId: backup.conversationId } : {}),
          ...(backup.payload.createdAt ? { createdAt: backup.payload.createdAt } : {}),
          nonce: backup.payload.nonce,
          ciphertext: backup.payload.ciphertext,
        };
        if (kind === "message") {
          const message = await decryptRecoveryRecord<LocalMessage>(
            kind,
            encrypted,
            key,
            userId,
            targetDeviceId,
          );
          if (
            message.id !== backup.recordId ||
            typeof message.conversationId !== "string" ||
            typeof message.plaintext !== "string" ||
            typeof message.createdAt !== "string"
          ) {
            throw new Error("A stored message recovery record is invalid.");
          }
          await saveLocalMessage(message);
        } else {
          const session = await decryptRecoveryRecord<StoredSession>(
            kind,
            encrypted,
            key,
            userId,
            targetDeviceId,
          );
          if (
            !session.conversationId ||
            !session.remoteDeviceId ||
            (session.direction !== "incoming" && session.direction !== "outgoing") ||
            sessionKey(
              session.conversationId,
              session.remoteDeviceId,
              session.direction,
            ) !== backup.recordId
          ) {
            throw new Error("A stored ratchet recovery record is invalid.");
          }
          await saveSession(session, session.direction);
        }
      }
      after = page.records.at(-1)?.recordId;
      if (page.records.length < 100 || !after) break;
    }
  }
}

async function syncLocalRecoveryRecords() {
  if (!deviceId || !vaultKey || !identityUserId) return;
  if (!accountArchiveKey) {
    throw new Error("Sign in again with your password to unlock cross-device message history.");
  }
  const { conversations } = await api.conversations();
  for (const conversation of conversations) {
    await syncConversationMessageDeletions(conversation.id);
  }
  const accountConversationIds = new Set(conversations.map((conversation) => conversation.id));
  const localMessages = (await listAllLocalMessages())
    .filter((message) => accountConversationIds.has(message.conversationId));
  let after: string | undefined;
  const serverMessageIds = new Set<string>();
  while (true) {
    const page = await api.recoveryRecords(deviceId, "message", after);
    for (const record of page.records) serverMessageIds.add(record.recordId);
    after = page.records.at(-1)?.recordId;
    if (page.records.length < 100 || !after) break;
  }

  const missingMessages = localMessages.filter((message) => !serverMessageIds.has(message.id));
  for (let offset = 0; offset < missingMessages.length; offset += 100) {
    const records = await Promise.all(
      missingMessages.slice(offset, offset + 100).map((message) =>
        encryptRecoveryRecord("message", message.id, {
          value: message,
          conversationId: message.conversationId,
          createdAt: message.createdAt,
        }),
      ),
    );
    await uploadRecoveryRecords("message", records);
  }

  const sessions = (await listAllSessions())
    .filter((session) => accountConversationIds.has(session.conversationId));
  for (let offset = 0; offset < sessions.length; offset += 100) {
    const records = await Promise.all(
      sessions.slice(offset, offset + 100).map((session) => {
        const recordId = sessionKey(
          session.conversationId,
          session.remoteDeviceId,
          session.direction,
        );
        return encryptRecoveryRecord("session", recordId, {
          value: session,
          conversationId: session.conversationId,
        });
      }),
    );
    await uploadRecoveryRecords("session", records);
  }

  for (const conversation of conversations) {
    await syncConversationMessageDeletions(conversation.id);
    const archivedIds = new Set<string>();
    let archiveAfter: string | undefined;
    while (true) {
      const page = await api.archiveMessages(conversation.id, archiveAfter);
      for (const record of page.records) archivedIds.add(record.logicalMessageId);
      archiveAfter = page.records.at(-1)?.logicalMessageId;
      if (page.records.length < 100 || !archiveAfter) break;
    }

    const senderById = new Map(
      localMessages
        .filter((message) => message.conversationId === conversation.id)
        .map((message) => [message.logicalMessageId ?? message.id, message]),
    );
    const records = [];
    for (const [logicalMessageId, message] of senderById) {
      if (archivedIds.has(logicalMessageId)) continue;
      const senderUserId = message.senderUserId ??
        (message.fromMe ? identityUserId : conversation.peer?.id);
      if (!senderUserId) continue;
      const encrypted = await encryptArchiveMessage(
        identityUserId,
        conversation.id,
        logicalMessageId,
        message.plaintext,
        accountArchiveKey.publicKey,
      );
      records.push({
        logicalMessageId,
        conversationId: conversation.id,
        senderUserId,
        senderDeviceId: message.senderDeviceId,
        ephemeralPublicKey: encrypted.ephemeralPublicKey,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        createdAt: message.createdAt,
      });
    }
    for (let offset = 0; offset < records.length; offset += 10) {
      await api.saveAccountArchiveMessages(records.slice(offset, offset + 10));
    }
  }
}

export async function syncConversationMessageDeletions(conversationId: string) {
  let after: string | undefined;
  while (true) {
    const page = await api.deletedMessages(conversationId, after);
    for (const deletion of page.deletions) {
      await applyRemoteMessageDeletion(
        conversationId,
        deletion.logicalMessageId,
        deletion.messageRecordIds,
      );
    }
    after = page.deletions.at(-1)?.logicalMessageId;
    if (page.deletions.length < 100 || !after) break;
  }
}

async function archiveLocalMessages(messages: LocalMessage[]) {
  if (!identityUserId || !accountArchiveKey || messages.length === 0) return;
  const uniqueMessages = new Map(
    messages.map((message) => [message.logicalMessageId ?? message.id, message]),
  );
  const records = [];
  for (const [logicalMessageId, message] of uniqueMessages) {
    const senderUserId = message.senderUserId ??
      (message.fromMe ? identityUserId : undefined);
    if (!senderUserId) continue;
    const encrypted = await encryptArchiveMessage(
      identityUserId,
      message.conversationId,
      logicalMessageId,
      message.plaintext,
      accountArchiveKey.publicKey,
    );
    records.push({
      logicalMessageId,
      conversationId: message.conversationId,
      senderUserId,
      senderDeviceId: message.senderDeviceId,
      ephemeralPublicKey: encrypted.ephemeralPublicKey,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      createdAt: message.createdAt,
    });
  }
  for (let offset = 0; offset < records.length; offset += 10) {
    await api.saveAccountArchiveMessages(records.slice(offset, offset + 10));
  }
}

let historySync: Promise<void> | null = null;

export async function syncConversationRecoveryHistory(
  onProgress?: (progress: { conversation: number; total: number; messages: number }) => void,
) {
  if (!identity || !deviceId || !vaultKey || !identityUserId) {
    throw new Error("Unlock this device before syncing message recovery.");
  }
  if (historySync) return historySync;

  historySync = (async () => {
    const activeDeviceId = deviceId!;
    if (!accountArchiveKey) {
      throw new Error("Sign in again with your password to unlock cross-device message history.");
    }
    const { conversations } = await api.conversations();
    let messagesSynced = 0;
    for (const [index, conversation] of conversations.entries()) {
      await syncConversationMessageDeletions(conversation.id);
      let archiveAfter: string | undefined;
      while (true) {
        const page = await api.archiveMessages(conversation.id, archiveAfter);
        for (const record of page.records) {
          if (isMessageDeleted(conversation.id, record.logicalMessageId)) continue;
          const plaintext = await decryptArchiveMessage(
            accountArchiveKey,
            identityUserId!,
            conversation.id,
            record.logicalMessageId,
            record,
          );
          await saveLocalMessage({
            id: record.logicalMessageId,
            logicalMessageId: record.logicalMessageId,
            conversationId: record.conversationId,
            senderDeviceId: record.senderDeviceId,
            senderUserId: record.senderUserId,
            fromMe: record.senderUserId === identityUserId,
            plaintext,
            createdAt: record.createdAt,
          });
          if (isMessageDeleted(conversation.id, record.logicalMessageId)) {
            await deleteLocalMessages(conversation.id, record.logicalMessageId);
            continue;
          }
          queueRecoveryRecord("message", record.logicalMessageId, {
            id: record.logicalMessageId,
            logicalMessageId: record.logicalMessageId,
            conversationId: record.conversationId,
            senderDeviceId: record.senderDeviceId,
            senderUserId: record.senderUserId,
            fromMe: record.senderUserId === identityUserId,
            plaintext,
            createdAt: record.createdAt,
          }, {
            conversationId: record.conversationId,
            createdAt: record.createdAt,
          });
          messagesSynced += 1;
        }
        archiveAfter = page.records.at(-1)?.logicalMessageId;
        onProgress?.({
          conversation: index + 1,
          total: conversations.length,
          messages: messagesSynced,
        });
        if (page.records.length < 100 || !archiveAfter) break;
      }

      let after: { id: string } | undefined;
      while (true) {
        const { messages } = await api.messages(
          conversation.id,
          activeDeviceId,
          undefined,
          !after,
          after?.id,
          100,
        );
        if (messages.length === 0) break;
        await ingestWireMessages(messages, { strict: true });
        if (recoveryBackupError) {
          throw new Error(
            `Encrypted recovery backup failed: ${recoveryBackupError}`,
          );
        }
        messagesSynced += messages.length;
        onProgress?.({
          conversation: index + 1,
          total: conversations.length,
          messages: messagesSynced,
        });
        const last = messages.at(-1);
        if (!last || messages.length < 100) break;
        after = { id: last.id };
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
    }
    await syncLocalRecoveryRecords();
    const vault = identityUserId ? await loadVault(identityUserId) : undefined;
    if (vault) await saveRecoveryVault(vault);
    if (recoveryBackupError) {
      throw new Error(
        `Encrypted recovery backup failed: ${recoveryBackupError}`,
      );
    }
  })().finally(() => {
    historySync = null;
  });
  return historySync;
}

export async function syncCurrentDeviceRecovery() {
  if (!identity || !deviceId || !vaultKey || !identityUserId) {
    throw new Error("Unlock this device before syncing message recovery.");
  }
  await syncLocalRecoveryRecords();
  const vault = await loadVault(identityUserId);
  if (!vault) throw new Error("This device's encrypted vault is missing.");
  await saveRecoveryVault(vault);
  if (recoveryBackupError) throw new Error(recoveryBackupError);
}

async function saveRecoveryVault(vault: VaultRecord) {
  if (!deviceId || !identityUserId) throw new Error("Device is locked");
  await api.saveRecoveryVault(deviceId, {
    ...vault,
    userId: identityUserId,
    version: vault.version ?? 1,
  });
}

async function cacheAccountArchiveKey(
  userId: string,
  material: AccountArchiveMaterial,
) {
  if (!vaultKey) throw new Error("The encrypted device vault is unavailable.");
  const cached = await encryptDeviceBackup(
    vaultKey,
    `account-archive-local:v1:${userId}`,
    material,
  );
  await saveAccountArchiveCache(userId, cached);
}

async function loadCachedAccountArchiveKey(userId: string, key: CryptoKey) {
  const cached = await loadAccountArchiveCache(userId);
  if (!cached) return null;
  return decryptDeviceBackup<AccountArchiveMaterial>(
    key,
    `account-archive-local:v1:${userId}`,
    cached,
  );
}

async function cachePendingArchiveRecoveryCode(
  userId: string,
  publicKey: string,
  recoveryCode: string,
) {
  if (!vaultKey) throw new Error("The encrypted device vault is unavailable.");
  const cached = await encryptDeviceBackup(
    vaultKey,
    `account-archive-pending-recovery-code:v1:${userId}:${publicKey}`,
    recoveryCode,
  );
  await savePendingArchiveRecoveryCode(userId, { publicKey, ...cached });
}

async function loadPendingArchiveRecoveryCodeForKey(userId: string, publicKey: string) {
  if (!vaultKey) return null;
  const pending = await loadPendingArchiveRecoveryCode(userId);
  if (!pending) return null;
  if (pending.publicKey !== publicKey) {
    await deletePendingArchiveRecoveryCode(userId);
    return null;
  }
  return decryptDeviceBackup<string>(
    vaultKey,
    `account-archive-pending-recovery-code:v1:${userId}:${publicKey}`,
    pending,
  );
}

async function ensureAccountArchiveKey(
  password: string,
  userId: string,
  recoveryCode?: string,
  restoredMaterial?: AccountArchiveMaterial,
) {
  let { key: remoteKey } = await api.accountArchiveKey();
  let recoveryCodeToShow: string | undefined;

  if (!remoteKey) {
    if (restoredMaterial) {
      if (!recoveryCode) {
        throw new Error("The history recovery code is required to restore the Google Drive backup.");
      }
      if (
        accountArchiveKey &&
        accountArchiveKey.publicKey !== restoredMaterial.publicKey
      ) {
        throw new Error("The Google Drive backup does not match this device's cached archive key.");
      }
      await api.createAccountArchiveKey(
        await createAccountArchiveKeyRecord(
          password,
          userId,
          recoveryCode,
          restoredMaterial,
        ),
      );
      accountArchiveKey = restoredMaterial;
    } else {
      if (accountArchiveKey) {
        throw new Error("The server account archive key is missing; refusing to replace the key for existing history.");
      }
      const generated = await createAccountArchiveKey(password, userId);
      await cachePendingArchiveRecoveryCode(
        userId,
        generated.material.publicKey,
        generated.recoveryCode,
      );
      try {
        await api.createAccountArchiveKey(generated.record);
        accountArchiveKey = generated.material;
        recoveryCodeToShow = generated.recoveryCode;
      } catch (createError) {
        try {
          remoteKey = (await api.accountArchiveKey()).key;
        } catch {
          throw createError;
        }
        if (!remoteKey) {
          await deletePendingArchiveRecoveryCode(userId);
          throw createError;
        }
        if (remoteKey.publicKey === generated.record.publicKey) {
          accountArchiveKey = generated.material;
          recoveryCodeToShow = generated.recoveryCode;
          remoteKey = null;
        } else {
          await deletePendingArchiveRecoveryCode(userId);
        }
      }
    }
  }

  if (remoteKey) {
    const pendingCode = await loadPendingArchiveRecoveryCodeForKey(
      userId,
      remoteKey.publicKey,
    );
    const recoveryCodeToUse = pendingCode ?? recoveryCode;
    const unlocked = await unlockAccountArchiveKey(
      password,
      userId,
      remoteKey,
      recoveryCodeToUse,
    );
    if (
      restoredMaterial &&
      restoredMaterial.publicKey !== unlocked.material.publicKey
    ) {
      throw new Error("The Google Drive backup belongs to a different archive key.");
    }
    accountArchiveKey = unlocked.material;
    if (unlocked.passwordWrap) {
      if (!recoveryCodeToUse) {
        throw new Error("A history recovery code is required to unlock this archive.");
      }
      await api.rewrapAccountArchivePassword(
        await recoveryCodeDigest(recoveryCodeToUse),
        archivePasswordWrapRecord(unlocked.passwordWrap),
      );
    }
    recoveryCodeToShow = pendingCode ?? undefined;
  }

  if (!accountArchiveKey) throw new Error("The account archive key is unavailable.");
  await cacheAccountArchiveKey(userId, accountArchiveKey);
  if (recoveryCodeToShow) {
    await cachePendingArchiveRecoveryCode(
      userId,
      accountArchiveKey.publicKey,
      recoveryCodeToShow,
    );
    publishPendingArchiveRecoveryCode(recoveryCodeToShow);
  } else {
    publishPendingArchiveRecoveryCode(null);
  }
  return recoveryCodeToShow;
}

export function getPendingArchiveRecoveryCode() {
  return pendingArchiveRecoveryCodeToDisplay;
}

export async function createGoogleDriveArchiveBackup(
  userId: string,
  recoveryCode: string,
): Promise<AccountArchiveDriveBackup> {
  if (
    !identityUserId ||
    identityUserId !== userId ||
    !accountArchiveKey
  ) {
    throw new Error("Unlock the matching account before creating its archive backup.");
  }
  return encryptAccountArchiveDriveBackup(accountArchiveKey, userId, recoveryCode);
}

export async function acknowledgeArchiveRecoveryCode() {
  if (identityUserId) {
    await deletePendingArchiveRecoveryCode(identityUserId);
  }
  publishPendingArchiveRecoveryCode(null);
}

/**
 * All cryptographic session mutations are serialized.
 *
 * This is extremely important.
 *
 * Two simultaneous sends/decryptions must never mutate
 * the same ratchet state concurrently.
 */
let sessionQueue =
  Promise.resolve();

const MAX_PENDING_INCOMING = 256;
const pendingIncoming = new Map<string, WireMessage[]>();
let pendingIncomingCount = 0;
const deletedMessageIdsByConversation = new Map<string, Set<string>>();

function isMessageDeleted(conversationId: string, ...messageIds: (string | null | undefined)[]) {
  const deletedIds = deletedMessageIdsByConversation.get(conversationId);
  return Boolean(deletedIds && messageIds.some((id) => id && deletedIds.has(id)));
}

export async function applyRemoteMessageDeletion(
  conversationId: string,
  logicalMessageId: string,
  messageRecordIds: string[] = [],
) {
  const deletedIds = deletedMessageIdsByConversation.get(conversationId) ?? new Set<string>();
  deletedIds.add(logicalMessageId);
  for (const id of messageRecordIds) deletedIds.add(id);
  deletedMessageIdsByConversation.set(conversationId, deletedIds);

  await withSessionLock(async () => {
    for (const [key, pending] of pendingIncoming) {
      const retained = pending.filter((message) =>
        message.conversationId !== conversationId ||
        !isMessageDeleted(conversationId, message.id, message.logicalMessageId),
      );
      pendingIncomingCount -= pending.length - retained.length;
      if (retained.length) pendingIncoming.set(key, retained);
      else pendingIncoming.delete(key);
    }

    const queuedMessages = pendingRecoveryRecords.get("message");
    if (queuedMessages) {
      for (const [recordId, record] of queuedMessages) {
        if (
          record.conversationId === conversationId &&
          isMessageDeleted(conversationId, recordId)
        ) {
          queuedMessages.delete(recordId);
        }
      }
    }

    await deleteLocalMessages(conversationId, logicalMessageId, messageRecordIds);
  });
}

function pendingIncomingKey(message: WireMessage) {
  return JSON.stringify([
    message.conversationId,
    message.senderDeviceId,
  ]);
}

function enqueuePendingIncoming(message: WireMessage) {
  if (isMessageDeleted(message.conversationId, message.id, message.logicalMessageId)) return;
  const key = pendingIncomingKey(message);
  const pending = pendingIncoming.get(key) ?? [];
  if (pending.some((item) => item.id === message.id)) return;

  if (pendingIncomingCount >= MAX_PENDING_INCOMING) {
    const oldestKey = pendingIncoming.keys().next().value;
    if (oldestKey !== undefined) {
      const oldest = pendingIncoming.get(oldestKey);
      if (oldest?.length) {
        const dropped = oldest.shift();
        pendingIncomingCount -= 1;
        if (dropped) {
          console.warn(
            "Dropped deferred incoming ciphertext because the retry queue is full",
            dropped.id,
          );
        }
      }
      if (!oldest?.length) pendingIncoming.delete(oldestKey);
    }
  }

  pending.push(message);
  pendingIncoming.set(key, pending);
  pendingIncomingCount += 1;
}

async function retryPendingIncoming(message: WireMessage) {
  const key = pendingIncomingKey(message);
  const pending = pendingIncoming.get(key);
  if (!pending?.length) return;

  pendingIncoming.delete(key);
  pendingIncomingCount -= pending.length;
  pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const deferred of pending) {
    if (isMessageDeleted(
      deferred.conversationId,
      deferred.id,
      deferred.logicalMessageId,
    )) continue;
    try {
      await decryptIncomingLocked(deferred, false);
    } catch (error) {
      console.warn("Could not decrypt deferred message", deferred.id, error);
      enqueuePendingIncoming(deferred);
    }
  }
}

function withSessionLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result =
    sessionQueue.then(
      operation,
    );

  sessionQueue =
    result.then(
      () => undefined,
      () => undefined,
    );

  return result;
}

async function updateCachedMessageSender(
  message: WireMessage,
  stored: LocalMessage | undefined,
) {
  if (!stored || !message.senderUserId) return;
  const fromMe = message.senderUserId === identityUserId;
  if (
    stored.senderUserId !== message.senderUserId ||
    stored.logicalMessageId !== (message.logicalMessageId ?? message.id) ||
    stored.fromMe !== fromMe
  ) {
    const updated = {
      ...stored,
      senderUserId: message.senderUserId,
      logicalMessageId: message.logicalMessageId ?? message.id,
      fromMe,
    };
    await saveLocalMessage(updated);
    queueRecoveryRecord("message", updated.id, updated, {
      conversationId: updated.conversationId,
      createdAt: updated.createdAt,
    });
  }
}

export function cryptoSupported(): boolean {
  return (
    typeof crypto !==
      "undefined" &&
    "subtle" in crypto
  );
}

export function isUnlocked(): boolean {
  return Boolean(
    identity &&
      deviceId,
  );
}

export async function lockDevice() {
  await withSessionLock(
    async () => {
      await recoveryFlushQueue;
      identity = null;
      deviceId = null;
      identityUserId = null;
      vaultKey = null;
      accountArchiveKey = null;
      publishPendingArchiveRecoveryCode(null);
      recoveryBackupError = null;
      pendingRecoveryRecords.clear();
      pendingIncoming.clear();
      pendingIncomingCount = 0;
      deletedMessageIdsByConversation.clear();
    },
  );
}

export function currentDeviceId(): string {
  if (!deviceId) {
    throw new Error(
      "Device is locked",
    );
  }

  return deviceId;
}

export function currentUserId(): string | null {
  return identityUserId;
}

export async function bootstrapDevice(
  password: string,
  recoveryCode?: string,
  restoredArchiveMaterial?: AccountArchiveMaterial,
) {
  const account =
    await api.me();

  if (
    identityUserId &&
    identityUserId !== account.user.id
  ) {
    await lockDevice();
  }

  const existing =
    await loadVault(
      account.user.id,
    );

  const existingDeviceId =
    await loadDeviceId(
      account.user.id,
    );

  const belongsToAccount =
    existingDeviceId
      ? account.devices.some(
          (device) =>
            device.id ===
            existingDeviceId,
        )
      : false;

  if (
    existing &&
    existingDeviceId &&
    belongsToAccount &&
    (existing.version ?? 1) ===
      account.user.vaultVersion
  ) {
    const restoredKey = await deriveVaultKey(
      password,
      b64ToBytes(existing.salt),
    );
    const openedIdentity =
      await openVaultWithKey(restoredKey, existing);

    await saveRememberedVaultKey(account.user.id, restoredKey);
    identity = openedIdentity;
    deviceId =
      existingDeviceId;
    identityUserId =
      account.user.id;
    vaultKey = restoredKey;
    try {
      await restoreRecoveryRecords(existingDeviceId, restoredKey, account.user.id);
    } catch (error) {
      reportRecoveryBackupError(error);
    }
    const archiveRecoveryCode = await ensureAccountArchiveKey(
      password,
      account.user.id,
      recoveryCode,
      restoredArchiveMaterial,
    );
    try {
      await syncLocalRecoveryRecords();
      await saveRecoveryVault(existing);
    } catch (error) {
      reportRecoveryBackupError(error);
    }

    return {
      created: false,
      deviceId,
      recovered: false,
      historyUnavailable: false,
      archiveRecoveryCode,
    };
  }

  if (existing || existingDeviceId) {
    await clearSessions();
  }

  const newIdentity =
    await createIdentityMaterial();
  const vault = {
    ...await sealVault(
      password,
      newIdentity,
      account.user.id,
    ),
    version: account.user.vaultVersion,
  };
  await saveVault(
    vault,
    account.user.id,
  );
  const newVaultKey = await deriveVaultKey(
    password,
    b64ToBytes(vault.salt),
  );

  const registered =
    await api.registerDevice(
      devicePayload(
        newIdentity,
        navigator.userAgent.slice(
          0,
          72,
        ),
      ),
    );

  deviceId =
    registered.deviceId;

  await saveDeviceId(
    deviceId,
    account.user.id,
  );
  await saveRememberedVaultKey(account.user.id, newVaultKey);

  identity = newIdentity;
  identityUserId = account.user.id;
  vaultKey = newVaultKey;
  const archiveRecoveryCode = await ensureAccountArchiveKey(
    password,
    account.user.id,
    recoveryCode,
    restoredArchiveMaterial,
  );
  try {
    await syncLocalRecoveryRecords();
    await saveRecoveryVault(vault);
  } catch (error) {
    reportRecoveryBackupError(error);
  }

  return {
    created: true,
    deviceId,
    recovered: false,
    historyUnavailable: false,
    archiveRecoveryCode,
  };
}

export async function restoreRememberedDevice(account: {
  user: { id: string; vaultVersion: number };
  devices: { id: string }[];
}) {
  if (
    identity &&
    deviceId &&
    identityUserId === account.user.id
  ) {
    return true;
  }

  if (identityUserId && identityUserId !== account.user.id) {
    await lockDevice();
  }

  const rememberedKey = await loadRememberedVaultKey(account.user.id);
  if (!rememberedKey) {
    return false;
  }

  const [vault, rememberedDeviceId] = await Promise.all([
    loadVault(account.user.id),
    loadDeviceId(account.user.id),
  ]);
  if (
    !vault ||
    !rememberedDeviceId ||
    !account.devices.some((device) => device.id === rememberedDeviceId) ||
    (vault.version ?? 1) !== account.user.vaultVersion
  ) {
    await deleteRememberedVaultKey(account.user.id);
    return false;
  }

  let restoredIdentity;
  try {
    restoredIdentity = await openVaultWithKey(rememberedKey, vault);
  } catch {
    await deleteRememberedVaultKey(account.user.id);
    throw new Error("The remembered local vault key is invalid. Unlock this device with your password.");
  }

  identity = restoredIdentity;
  deviceId = rememberedDeviceId;
  identityUserId = account.user.id;
  vaultKey = rememberedKey;
  accountArchiveKey = await loadCachedAccountArchiveKey(account.user.id, rememberedKey);
  const pendingCode = accountArchiveKey
    ? await loadPendingArchiveRecoveryCodeForKey(
        account.user.id,
        accountArchiveKey.publicKey,
      )
    : null;
  publishPendingArchiveRecoveryCode(pendingCode);
  try {
    await restoreRecoveryRecords(rememberedDeviceId, rememberedKey, account.user.id);
    await syncLocalRecoveryRecords();
    await saveRecoveryVault(vault);
  } catch (error) {
    reportRecoveryBackupError(error);
  }
  return true;
}

export async function forgetRememberedDevice(userId: string) {
  await deleteRememberedVaultKey(userId);
  if (identityUserId === userId) {
    await lockDevice();
  }
}

export async function encryptOutgoing(
  conversationId: string,
  plaintext: string,
) {
  const result = await withSessionLock(
    () => encryptOutgoingLocked(conversationId, plaintext),
  );
  await flushRecoveryRecords();
  return result;
}

async function encryptOutgoingLocked(
  conversationId: string,
  plaintext: string,
) {
  if (
    !identity ||
    !deviceId ||
    !identityUserId ||
    !accountArchiveKey
  ) {
    throw new Error("Unlock this device and its account history key before sending messages.");
  }

  const logicalMessageId = crypto.randomUUID();
  const { keys: archiveKeys } = await api.archivePublicKeys(conversationId);
  if (!archiveKeys.some((key) =>
    key.userId === identityUserId && key.publicKey === accountArchiveKey!.publicKey,
  )) {
    throw new Error("Your account archive key changed. Sign in again before sending messages.");
  }
  const archiveEnvelopes = await Promise.all(
    archiveKeys.map((key) =>
      encryptArchiveMessage(
        key.userId,
        conversationId,
        logicalMessageId,
        plaintext,
        key.publicKey,
      ),
    ),
  );
  const { devices } = await api.recipientDevices(
    conversationId,
    deviceId,
  );
  if (devices.length === 0) {
    throw new Error("No active recipient devices are available for this conversation.");
  }

  const envelopes: EncryptedDeviceEnvelope[] = [];
  const updatedSessions: StoredSession[] = [];

  for (const recipient of devices) {
    let session = await loadSession(
      conversationId,
      recipient.deviceId,
      "outgoing",
    );

    if (session && !session.handshake) {
      await deleteSession(conversationId, recipient.deviceId, "outgoing");
      session = undefined;
    }

    const bundle = session
      ? undefined
      : await api.prekeyBundle(recipient.username, recipient.deviceId);
    const encrypted = await encryptForDevice(
      identity,
      conversationId,
      plaintext,
      recipient.deviceId,
      bundle
        ? {
            deviceId: bundle.deviceId,
            identityPublicKey: bundle.identityPublicKey,
            signingPublicKey: bundle.signingPublicKey,
            signedPreKey: {
              id: bundle.signedPreKeyId,
              publicKey: bundle.signedPreKey,
              signature: bundle.signedPreKeySig,
            },
            oneTimePreKey: bundle.oneTimePreKey
              ? {
                  id: bundle.oneTimePreKey.keyId,
                  publicKey: bundle.oneTimePreKey.publicKey,
                }
              : undefined,
          }
        : undefined,
      session,
    );
    envelopes.push(encrypted.envelope);
    updatedSessions.push(encrypted.session);
  }

  await saveSessions(updatedSessions);
  for (const session of updatedSessions) {
    queueRecoveryRecord(
      "session",
      sessionKey(session.conversationId, session.remoteDeviceId, session.direction),
      session,
      { conversationId: session.conversationId },
    );
  }

  return {
    senderDeviceId:
      deviceId,
    logicalMessageId,
    envelopes,
    archiveEnvelopes,
  };
}

export async function decryptIncoming(
  message: WireMessage,
) {
  const result = await withSessionLock(() => decryptIncomingLocked(message));
  await flushRecoveryRecords();
  return result;
}

async function decryptIncomingLocked(
  message: WireMessage,
  retryDeferred = true,
) {
  if (
    !identity ||
    !deviceId
  ) {
    throw new Error(
      "Device is locked",
    );
  }

  if (isMessageDeleted(message.conversationId, message.id, message.logicalMessageId)) {
    return null;
  }

  if (
    (message.recipientDeviceId &&
      message.recipientDeviceId !== deviceId) ||
    (message.ratchetHeader.recipientDeviceId &&
      message.ratchetHeader.recipientDeviceId !== deviceId)
  ) {
    return null;
  }

  const existingMessage = await getLocalMessage(message.id);
  if (existingMessage) {
    await updateCachedMessageSender(message, existingMessage);
    return null;
  }

  /**
   * Never decrypt our own message as incoming.
   */
  if (
    message.senderDeviceId ===
    deviceId
  ) {
    return null;
  }

  let session =
    await loadSession(
      message.conversationId,
      message.senderDeviceId,
      "incoming",
    );

  const hadCachedSession =
    Boolean(session);

  if (!session && message.ratchetHeader.spkId === undefined) {
    enqueuePendingIncoming(message);
    return null;
  }

  const createSession =
    async (): Promise<StoredSession> => {
      const state =
        await acceptSession(
          identity!,
          message.senderIdentityPublicKey,
          message.ratchetHeader.dh,
          message.ratchetHeader.otkId,
        );

      return {
        conversationId:
          message.conversationId,

        remoteDeviceId:
          message.senderDeviceId,

        direction:
          "incoming",

        remoteIdentity:
          message.senderIdentityPublicKey,

        state,
      };
    };

  session ??=
    await createSession();

  /**
   * NEVER mutate the persisted state until
   * decryption has succeeded.
   *
   * This is critical.
   */
  const workingState =
    structuredClone(
      session.state,
    );

  try {
    const decrypted =
      await ratchetDecrypt(
        workingState,
        message.ratchetHeader,
        message.ciphertext,
        message.nonce,
      );

    /**
     * Only persist the ratchet state after
     * successful authenticated decryption.
     */
    await saveSession(
      {
        ...session,

        state:
          decrypted.state,
      },
      "incoming",
    );
    queueRecoveryRecord(
      "session",
      sessionKey(session.conversationId, session.remoteDeviceId, "incoming"),
      { ...session, state: decrypted.state },
      { conversationId: session.conversationId },
    );

    const local:
      LocalMessage = {
      id:
        message.id,

      conversationId:
        message.conversationId,

      senderDeviceId:
        message.senderDeviceId,

      senderUserId:
        message.senderUserId,

      logicalMessageId:
        message.logicalMessageId ?? message.id,

      fromMe:
        message.senderUserId === identityUserId,

      plaintext:
        decrypted.plaintext,

      createdAt:
        message.createdAt,
    };

    await saveLocalMessage(
      local,
    );
    queueRecoveryRecord("message", local.id, local, {
      conversationId: local.conversationId,
      createdAt: local.createdAt,
    });
    if (retryDeferred) {
      await retryPendingIncoming(message);
    }

    const outgoingSession = await loadSession(
      message.conversationId,
      message.senderDeviceId,
      "outgoing",
    );

    if (
      outgoingSession &&
      (
        outgoingSession.remoteDeviceId !==
          message.senderDeviceId ||
        outgoingSession.remoteIdentity !==
          message.senderIdentityPublicKey
      )
    ) {
      await deleteSession(
        outgoingSession.conversationId,
        outgoingSession.remoteDeviceId,
        "outgoing",
      );
    }

    return local;
  } catch (error) {
    /**
     * If this is the first message of a cached session,
     * the cached session may have been created from
     * stale X3DH state.
     *
     * We can safely recreate it because no state was
     * persisted after the failed decrypt.
     */
    console.error(
      "[SESSION] Incoming message decryption failed",
      {
        messageId: message.id,
        conversationId: message.conversationId,
        senderDeviceId: message.senderDeviceId,
        messageNumber: message.ratchetHeader.n,
        hadCachedSession,
      },
    );

    if (
      message.ratchetHeader.n ===
        0 &&
      hadCachedSession
    ) {
      console.warn(
        "[SESSION] First message failed against cached session. Recreating session.",
      );

      await deleteSession(
        message.conversationId,
        message.senderDeviceId,
        "incoming",
      );

      const fresh =
        await createSession();

      const freshState =
        structuredClone(
          fresh.state,
        );

      const decrypted =
        await ratchetDecrypt(
          freshState,
          message.ratchetHeader,
          message.ciphertext,
          message.nonce,
        );

      await saveSession(
        {
          ...fresh,
          state:
            decrypted.state,
        },
        "incoming",
      );
      queueRecoveryRecord(
        "session",
        sessionKey(fresh.conversationId, fresh.remoteDeviceId, "incoming"),
        { ...fresh, state: decrypted.state },
        { conversationId: fresh.conversationId },
      );

      const local:
        LocalMessage = {
        id:
          message.id,

        conversationId:
          message.conversationId,

        senderDeviceId:
          message.senderDeviceId,

        senderUserId:
          message.senderUserId,

        logicalMessageId:
          message.logicalMessageId ?? message.id,

        fromMe:
          message.senderUserId === identityUserId,

        plaintext:
          decrypted.plaintext,

        createdAt:
          message.createdAt,
      };

      await saveLocalMessage(
        local,
      );
      queueRecoveryRecord("message", local.id, local, {
        conversationId: local.conversationId,
        createdAt: local.createdAt,
      });
      if (retryDeferred) {
        await retryPendingIncoming(message);
      }

      return local;
    }

    throw error;
  }
}

export async function storeSentMessage(
  input: {
    id: string;

    conversationId: string;

    plaintext: string;

    createdAt: string;
  },
) {
  if (!identityUserId) {
    throw new Error("Cannot store a sent message without an unlocked account.");
  }

  const local:
    LocalMessage = {
    id:
      input.id,

    conversationId:
      input.conversationId,

    senderDeviceId:
      currentDeviceId(),

    senderUserId:
      identityUserId,

    logicalMessageId:
      input.id,

    fromMe:
      true,

    plaintext:
      input.plaintext,

    createdAt:
      input.createdAt,
  };

  await saveLocalMessage(
    local,
  );
  queueRecoveryRecord("message", local.id, local, {
    conversationId: local.conversationId,
    createdAt: local.createdAt,
  });
  await flushRecoveryRecords();

  return local;
}

export async function conversationPlaintext(
  conversationId: string,
  limit = 50,
  before?: { createdAt: string; id: string },
) {
  const messages =
    await listLocalMessages(
      conversationId,
      limit,
      before,
    );

  return messages;
}

export async function ingestWireMessages(
  messages: WireMessage[],
  options: { strict?: boolean } = {},
) {
  const decrypted:
    LocalMessage[] = [];

  /**
   * Sort messages by server timestamp first.
   *
   * The ratchet itself supports skipped message
   * numbers, but deterministic processing is still
   * preferable.
   */
  const ordered =
    [...messages].sort(
      (a, b) =>
        a.createdAt.localeCompare(
          b.createdAt,
        ),
    );

  await withSessionLock(async () => {
    try {
      for (const message of ordered) {
        const stored = await getLocalMessage(message.id);
        if (stored) {
          await updateCachedMessageSender(message, stored);
          continue;
        }

        try {
          const local = await decryptIncomingLocked(message);
          if (local) decrypted.push(local);
        } catch (error) {
          if (options.strict) {
            throw new Error(
              `Could not recover message ${message.id}; this device's message keys may be missing.`,
              { cause: error },
            );
          }
          console.warn("Could not decrypt message", message.id, error);
        }
      }
    } finally {
      await flushRecoveryRecords();
    }
  });

  try {
    await archiveLocalMessages(decrypted);
  } catch (error) {
    reportRecoveryBackupError(error);
    if (options.strict) {
      throw new Error("Could not save decrypted messages to the account history archive.", {
        cause: error,
      });
    }
  }

  return decrypted;
}
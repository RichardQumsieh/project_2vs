import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { archiveRecoveryHashMatches } from "../src/archive-recovery.js";
import {
  createAccountArchiveKeySchema,
  deviceVaultBackupSchema,
  listDeviceBackupsQuery,
  saveAccountArchiveMessagesSchema,
  saveDeviceBackupsSchema,
} from "../src/schemas.js";

test("encrypted device recovery schemas", async (t) => {
  await t.test("accepts a versioned password-encrypted device vault", () => {
    assert.equal(deviceVaultBackupSchema.safeParse({
      vault: {
        userId: "11111111-1111-4111-8111-111111111111",
        version: 1,
        salt: "A".repeat(24),
        nonce: "A".repeat(16),
        ciphertext: "A".repeat(32),
      },
    }).success, true);
  });

  await t.test("requires bounded encrypted records with unique IDs", () => {
    const record = {
      recordId: "message-1",
      conversationId: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-11-05T10:00:00.000Z",
      nonce: "A".repeat(16),
      ciphertext: "A".repeat(32),
    };
    assert.equal(saveDeviceBackupsSchema.safeParse({ records: [record] }).success, true);
    assert.equal(saveDeviceBackupsSchema.safeParse({
      records: [record, record],
    }).success, false);
    assert.equal(saveDeviceBackupsSchema.safeParse({
      records: [{ ...record, ciphertext: "A".repeat(512 * 1024 + 1) }],
    }).success, false);
  });

  await t.test("only allows the supported backup collections and bounded pages", () => {
    assert.equal(listDeviceBackupsQuery.safeParse({ kind: "message" }).success, true);
    assert.equal(listDeviceBackupsQuery.safeParse({ kind: "vault" }).success, false);
    assert.equal(listDeviceBackupsQuery.safeParse({ kind: "session", limit: 101 }).success, false);
  });

  await t.test("validates password and recovery wrapped account archive keys", () => {
    const key = {
      publicKey: `${"A".repeat(43)}=`,
      passwordSalt: `${"A".repeat(22)}==`,
      passwordNonce: "A".repeat(16),
      passwordEncryptedPrivateKey: "A".repeat(32),
      recoverySalt: `${"B".repeat(22)}==`,
      recoveryNonce: "B".repeat(16),
      recoveryEncryptedPrivateKey: "B".repeat(32),
      recoveryCodeHash: `${"C".repeat(43)}=`,
    };
    assert.equal(createAccountArchiveKeySchema.safeParse({ key }).success, true);
    assert.equal(createAccountArchiveKeySchema.safeParse({
      key: { ...key, publicKey: "not-a-key" },
    }).success, false);
  });

  await t.test("accepts bounded account archive message ciphertext", () => {
    const record = {
      logicalMessageId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      senderUserId: "33333333-3333-4333-8333-333333333333",
      senderDeviceId: "44444444-4444-4444-8444-444444444444",
      ephemeralPublicKey: `${"A".repeat(43)}=`,
      nonce: "A".repeat(16),
      ciphertext: "A".repeat(24),
      createdAt: "2026-11-05T10:00:00.000Z",
    };
    assert.equal(saveAccountArchiveMessagesSchema.safeParse({ records: [record] }).success, true);
    assert.equal(saveAccountArchiveMessagesSchema.safeParse({
      records: [record, record],
    }).success, false);
  });
});

test("archive recovery authorization compares hashes and does not accept a different code", () => {
  const stored = createHash("sha256").update("SAVED-RECOVERY-CODE").digest("base64");
  const same = createHash("sha256").update("SAVED-RECOVERY-CODE").digest("base64");
  const other = createHash("sha256").update("OTHER-RECOVERY-CODE").digest("base64");

  assert.equal(archiveRecoveryHashMatches(stored, same), true);
  assert.equal(archiveRecoveryHashMatches(stored, other), false);
  assert.equal(archiveRecoveryHashMatches(stored, "not-base64"), false);
  assert.equal(archiveRecoveryHashMatches(stored, ""), false);
});

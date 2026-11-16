import { describe, expect, it } from "vitest";
import {
  createAccountArchiveKeyRecord,
  createAccountArchiveKey,
  decryptAccountArchiveDriveBackup,
  decryptArchiveMessage,
  encryptAccountArchiveDriveBackup,
  encryptArchiveMessage,
  unlockAccountArchiveKey,
} from "./account-archive";

describe("portable account message archive", () => {
  it("unlocks on another device with the password and recovery code", async () => {
    const userId = "user-id";
    const generated = await createAccountArchiveKey("correct horse battery staple", userId);

    await expect(
      unlockAccountArchiveKey("correct horse battery staple", userId, generated.record),
    ).resolves.toMatchObject({
      material: { publicKey: generated.material.publicKey },
    });

    const recovered = await unlockAccountArchiveKey(
      "new password after reset",
      userId,
      generated.record,
      generated.recoveryCode,
    );
    expect(recovered.material.publicKey).toBe(generated.material.publicKey);
    expect(recovered.passwordWrap).toBeDefined();
  });

  it("rejects a wrong recovery code", async () => {
    const generated = await createAccountArchiveKey("correct horse battery staple", "user-id");

    await expect(
      unlockAccountArchiveKey(
        "new password",
        "user-id",
        generated.record,
        "0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000",
      ),
    ).rejects.toBeDefined();
  });

  it("encrypts a Drive backup with the recovery code and restores the same archive key", async () => {
    const userId = "drive-user";
    const generated = await createAccountArchiveKey("account password", userId);
    const backup = await encryptAccountArchiveDriveBackup(
      generated.material,
      userId,
      generated.recoveryCode,
    );

    expect(backup.ciphertext).not.toContain(generated.material.privateJwk.d);
    await expect(
      decryptAccountArchiveDriveBackup(backup, userId, generated.recoveryCode),
    ).resolves.toEqual(generated.material);
    await expect(
      decryptAccountArchiveDriveBackup(backup, "another-user", generated.recoveryCode),
    ).rejects.toThrow("could not decrypt");
    await expect(
      decryptAccountArchiveDriveBackup(backup, userId, "incorrect recovery code"),
    ).rejects.toThrow("could not decrypt");
  });

  it("can rewrap a Drive-restored archive key for a new server record", async () => {
    const userId = "restore-user";
    const generated = await createAccountArchiveKey("original password", userId);
    const record = await createAccountArchiveKeyRecord(
      "new password",
      userId,
      generated.recoveryCode,
      generated.material,
    );

    await expect(
      unlockAccountArchiveKey("new password", userId, record),
    ).resolves.toMatchObject({
      material: { publicKey: generated.material.publicKey },
    });
  });

  it("encrypts history for its account key and authenticates archive identity", async () => {
    const generated = await createAccountArchiveKey("correct horse battery staple", "owner-id");
    const plaintext = JSON.stringify({ text: "private archived message" });
    const envelope = await encryptArchiveMessage(
      "owner-id",
      "conversation-id",
      "message-id",
      plaintext,
      generated.material.publicKey,
    );

    expect(envelope.ciphertext).not.toContain(plaintext);
    await expect(
      decryptArchiveMessage(
        generated.material,
        "owner-id",
        "conversation-id",
        "message-id",
        envelope,
      ),
    ).resolves.toBe(plaintext);
    await expect(
      decryptArchiveMessage(
        generated.material,
        "another-owner",
        "conversation-id",
        "message-id",
        envelope,
      ),
    ).rejects.toBeDefined();
  });
});

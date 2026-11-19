import { describe, expect, it } from "vitest";
import {
  createAccountArchiveKey,
  decryptAccountArchiveDriveBackup,
  decryptArchiveMessage,
  encryptAccountArchiveDriveBackup,
  encryptArchiveMessage,
  unlockAccountArchiveKey,
} from "./account-archive";
import { sealVault } from "./vault";
import type { IdentityMaterial } from "./types";

const deviceVault: IdentityMaterial = {
  identity: {
    x25519: {
      publicKey: "device-x25519",
      privateJwk: { kty: "OKP", crv: "X25519", x: "device-public", d: "device-scalar" },
    },
    signing: {
      publicKey: "device-signing",
      privateJwk: { kty: "OKP", crv: "Ed25519", x: "signing-public", d: "signing-scalar" },
    },
  },
  signedPreKey: {
    keyId: 1,
    publicKey: "signed-prekey",
    privateJwk: { kty: "OKP", crv: "X25519", x: "spk-public", d: "spk-scalar" },
    signature: "signature",
  },
  oneTimePreKeys: [],
};

describe("backup and new-device recovery drill", () => {
  it("restores archived history with the recovery code and does not clone the old device vault", async () => {
    const userId = "recovery-drill-user";
    const oldPassword = "original password phrase";
    const newPassword = "replacement password phrase";
    const chat = "drill plaintext that must stay off the server record";

    const firstDevice = await createAccountArchiveKey(oldPassword, userId);
    const oldVault = await sealVault(oldPassword, deviceVault, userId);
    const envelope = await encryptArchiveMessage(
      userId,
      "conversation-id",
      "message-id",
      chat,
      firstDevice.material.publicKey,
    );

    const serverRecord = JSON.stringify(firstDevice.record);
    expect(serverRecord).not.toContain(chat);
    expect(serverRecord).not.toContain(firstDevice.recoveryCode);
    expect(serverRecord).not.toContain(firstDevice.material.privateJwk.d);
    expect(JSON.stringify(oldVault)).not.toContain(deviceVault.identity.signing.privateJwk.d);

    await expect(
      unlockAccountArchiveKey(newPassword, userId, firstDevice.record),
    ).rejects.toThrow("ARCHIVE_RECOVERY_CODE_REQUIRED");

    const recovered = await unlockAccountArchiveKey(
      newPassword,
      userId,
      firstDevice.record,
      firstDevice.recoveryCode,
    );
    expect(recovered.material.publicKey).toBe(firstDevice.material.publicKey);
    expect(recovered.material.privateJwk.d).toBe(firstDevice.material.privateJwk.d);
    expect(recovered.passwordWrap).toBeDefined();
    expect(JSON.stringify(recovered.material)).not.toContain(deviceVault.identity.signing.privateJwk.d);

    await expect(
      decryptArchiveMessage(recovered.material, userId, "conversation-id", "message-id", envelope),
    ).resolves.toBe(chat);
    await expect(
      unlockAccountArchiveKey(newPassword, userId, firstDevice.record, "0000-1111-2222-3333"),
    ).rejects.toThrow("INVALID_ARCHIVE_RECOVERY_CODE");
  });

  it("restores the same archive key from the Drive ciphertext and the recovery code", async () => {
    const userId = "drive-drill-user";
    const firstDevice = await createAccountArchiveKey("account password", userId);
    const chat = "history restored from the drive backup";
    const envelope = await encryptArchiveMessage(
      userId,
      "conversation-id",
      "message-id",
      chat,
      firstDevice.material.publicKey,
    );
    const backup = await encryptAccountArchiveDriveBackup(
      firstDevice.material,
      userId,
      firstDevice.recoveryCode,
    );

    expect(JSON.stringify(backup)).not.toContain(chat);
    expect(JSON.stringify(backup)).not.toContain(firstDevice.material.privateJwk.d ?? "");
    expect(JSON.stringify(backup)).not.toContain(firstDevice.recoveryCode);

    const restored = await decryptAccountArchiveDriveBackup(
      backup,
      userId,
      firstDevice.recoveryCode,
    );
    await expect(
      decryptArchiveMessage(restored, userId, "conversation-id", "message-id", envelope),
    ).resolves.toBe(chat);
    await expect(
      decryptAccountArchiveDriveBackup(backup, userId, "wrong-recovery-code"),
    ).rejects.toThrow("could not decrypt");
  });
});
import { describe, expect, it } from "vitest";
import { deriveVaultKey } from "./kdf";
import { decryptDeviceBackup, encryptDeviceBackup } from "./device-backup";

describe("encrypted device recovery records", () => {
  it("round-trips recovery data using the password-derived vault key", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveVaultKey("account-password", salt);
    const scope = "user-id:device-id:message:message-id";
    const message = {
      conversationId: "conversation-id",
      plaintext: "This stays encrypted at rest on the server.",
    };

    const encrypted = await encryptDeviceBackup(key, scope, message);

    expect(encrypted.ciphertext).not.toContain(message.plaintext);
    await expect(decryptDeviceBackup(key, scope, encrypted)).resolves.toEqual(message);
  });

  it("rejects a wrong password key or a changed account/device/record scope", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveVaultKey("account-password", salt);
    const wrongKey = await deriveVaultKey("wrong-password", salt);
    const scope = "user-id:device-id:message:message-id";
    const encrypted = await encryptDeviceBackup(key, scope, { plaintext: "private" });

    await expect(decryptDeviceBackup(wrongKey, scope, encrypted)).rejects.toBeDefined();
    await expect(
      decryptDeviceBackup(key, "other-user:device-id:message:message-id", encrypted),
    ).rejects.toBeDefined();
    await expect(
      decryptDeviceBackup(key, "user-id:other-device:message:message-id", encrypted),
    ).rejects.toBeDefined();
  });
});

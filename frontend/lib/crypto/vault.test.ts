import { describe, expect, it } from "vitest";
import { b64ToBytes } from "./bytes";
import { deriveVaultKey } from "./kdf";
import { openVaultWithKey, sealVault } from "./vault";
import type { IdentityMaterial } from "./types";

const material: IdentityMaterial = {
  identity: {
    x25519: {
      publicKey: "identity-public",
      privateJwk: { kty: "OKP", crv: "X25519", x: "public", d: "private" },
    },
    signing: {
      publicKey: "signing-public",
      privateJwk: { kty: "OKP", crv: "Ed25519", x: "public", d: "private" },
    },
  },
  signedPreKey: {
    keyId: 1,
    publicKey: "signed-prekey-public",
    privateJwk: { kty: "OKP", crv: "X25519", x: "public", d: "private" },
    signature: "signature",
  },
  oneTimePreKeys: [],
};

describe("remembered vault CryptoKey", () => {
  it("opens the encrypted vault using a non-exportable derived CryptoKey", async () => {
    const vault = await sealVault("correct horse battery staple", material, "user-1");
    const key = await deriveVaultKey(
      "correct horse battery staple",
      b64ToBytes(vault.salt),
    );

    expect(key.extractable).toBe(false);
    await expect(openVaultWithKey(key, vault)).resolves.toEqual(material);
  });

  it("does not unlock the vault with a different password-derived key", async () => {
    const vault = await sealVault("correct horse battery staple", material, "user-1");
    const wrongKey = await deriveVaultKey(
      "different password",
      b64ToBytes(vault.salt),
    );

    await expect(openVaultWithKey(wrongKey, vault)).rejects.toBeDefined();
  });
});

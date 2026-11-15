import { asBufferSource, b64ToBytes, bytesToB64, bytesToUtf8, randomBytes, utf8ToBytes } from "./bytes";
import { deriveVaultKey } from "./kdf";
import type { IdentityMaterial, VaultRecord } from "./types";

export async function sealVault(
  password: string,
  material: IdentityMaterial,
  userId?: string,
): Promise<VaultRecord> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await deriveVaultKey(password, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(nonce) },
      key,
      asBufferSource(utf8ToBytes(JSON.stringify(material))),
    ),
  );
  return {
    userId,
    salt: bytesToB64(salt),
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(ciphertext),
  };
}

export async function openVault(password: string, record: VaultRecord): Promise<IdentityMaterial> {
  const key = await deriveVaultKey(password, b64ToBytes(record.salt));
  return openVaultWithKey(key, record);
}

export async function openVaultWithKey(
  key: CryptoKey,
  record: VaultRecord,
): Promise<IdentityMaterial> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(b64ToBytes(record.nonce)) },
    key,
    asBufferSource(b64ToBytes(record.ciphertext)),
  );
  return JSON.parse(bytesToUtf8(new Uint8Array(plaintext))) as IdentityMaterial;
}

import {
  asBufferSource,
  b64ToBytes,
  bytesToB64,
  bytesToUtf8,
  randomBytes,
  utf8ToBytes,
} from "./bytes";

export type EncryptedDeviceBackup = {
  nonce: string;
  ciphertext: string;
};

function additionalData(scope: string) {
  return utf8ToBytes(`private-messenger/device-backup/v1:${scope}`);
}

export async function encryptDeviceBackup(
  key: CryptoKey,
  scope: string,
  value: unknown,
): Promise<EncryptedDeviceBackup> {
  const nonce = randomBytes(12);
  const plaintext = utf8ToBytes(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(additionalData(scope)),
    },
    key,
    asBufferSource(plaintext),
  ));
  return {
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(ciphertext),
  };
}

export async function decryptDeviceBackup<T>(
  key: CryptoKey,
  scope: string,
  record: EncryptedDeviceBackup,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(b64ToBytes(record.nonce)),
      additionalData: asBufferSource(additionalData(scope)),
    },
    key,
    asBufferSource(b64ToBytes(record.ciphertext)),
  );
  return JSON.parse(bytesToUtf8(new Uint8Array(plaintext))) as T;
}

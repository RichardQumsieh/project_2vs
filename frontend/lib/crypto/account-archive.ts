import { b64ToBytes, bytesToB64, randomBytes, utf8ToBytes, asBufferSource } from "./bytes";
import { deriveVaultKey } from "./kdf";
import { dh, generateX25519 } from "./keys";

export type AccountArchiveKeyRecord = {
  publicKey: string;
  passwordSalt: string;
  passwordNonce: string;
  passwordEncryptedPrivateKey: string;
  recoverySalt: string;
  recoveryNonce: string;
  recoveryEncryptedPrivateKey: string;
  recoveryCodeHash?: string;
};

export type NewAccountArchiveKeyRecord = AccountArchiveKeyRecord & {
  recoveryCodeHash: string;
};

export type AccountArchiveDriveBackup = {
  format: "private-messenger-account-archive";
  version: 1;
  publicKey: string;
  salt: string;
  nonce: string;
  ciphertext: string;
};

export type AccountArchiveMaterial = {
  publicKey: string;
  privateJwk: JsonWebKey;
};

export type ArchiveEnvelope = {
  ownerUserId: string;
  recipientPublicKey: string;
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
};

type WrappedValue = {
  salt: string;
  nonce: string;
  ciphertext: string;
};

const privateKeyScope = (userId: string, type: "password" | "recovery") =>
  `private-messenger/account-archive-key/${type}/v1:${userId}`;

const driveBackupScope = (userId: string) =>
  `private-messenger/google-drive-archive-backup/v1:${userId}`;

function normalizedRecoveryCode(code: string) {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function recoveryCodeFromBytes(bytes: Uint8Array) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return hex.match(/.{1,4}/g)!.join("-");
}

async function hashRecoveryCode(code: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    asBufferSource(utf8ToBytes(normalizedRecoveryCode(code))),
  );
  return bytesToB64(new Uint8Array(digest));
}

export async function recoveryCodeDigest(code: string) {
  return hashRecoveryCode(code);
}

async function encryptPrivateKey(
  password: string,
  userId: string,
  type: "password" | "recovery",
  privateJwk: JsonWebKey,
): Promise<WrappedValue> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await deriveVaultKey(password, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(utf8ToBytes(privateKeyScope(userId, type))),
    },
    key,
    asBufferSource(utf8ToBytes(JSON.stringify(privateJwk))),
  ));
  return {
    salt: bytesToB64(salt),
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(ciphertext),
  };
}

async function decryptPrivateKey(
  password: string,
  userId: string,
  type: "password" | "recovery",
  wrapped: WrappedValue,
): Promise<JsonWebKey> {
  const key = await deriveVaultKey(password, b64ToBytes(wrapped.salt));
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(b64ToBytes(wrapped.nonce)),
      additionalData: asBufferSource(utf8ToBytes(privateKeyScope(userId, type))),
    },
    key,
    asBufferSource(b64ToBytes(wrapped.ciphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as JsonWebKey;
}

function validateArchiveMaterial(material: AccountArchiveMaterial) {
  const encodedPublicKey = material.privateJwk.x;
  const decodedPublicKey = typeof encodedPublicKey === "string"
    ? b64ToBytes(encodedPublicKey.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - encodedPublicKey.length % 4) % 4))
    : new Uint8Array();
  if (
    material.privateJwk.kty !== "OKP" ||
    material.privateJwk.crv !== "X25519" ||
    typeof material.privateJwk.d !== "string" ||
    bytesToB64(decodedPublicKey) !== material.publicKey ||
    b64ToBytes(material.publicKey).length !== 32
  ) {
    throw new Error("The account archive private key does not match its public key.");
  }
}

export async function createAccountArchiveKeyRecord(
  password: string,
  userId: string,
  recoveryCode: string,
  material: AccountArchiveMaterial,
): Promise<NewAccountArchiveKeyRecord> {
  validateArchiveMaterial(material);
  const passwordWrap = await encryptPrivateKey(
    password,
    userId,
    "password",
    material.privateJwk,
  );
  const recoveryWrap = await encryptPrivateKey(
    recoveryCode,
    userId,
    "recovery",
    material.privateJwk,
  );
  return {
    publicKey: material.publicKey,
    passwordSalt: passwordWrap.salt,
    passwordNonce: passwordWrap.nonce,
    passwordEncryptedPrivateKey: passwordWrap.ciphertext,
    recoverySalt: recoveryWrap.salt,
    recoveryNonce: recoveryWrap.nonce,
    recoveryEncryptedPrivateKey: recoveryWrap.ciphertext,
    recoveryCodeHash: await hashRecoveryCode(recoveryCode),
  };
}

export async function createAccountArchiveKey(
  password: string,
  userId: string,
): Promise<{
  record: NewAccountArchiveKeyRecord;
  material: AccountArchiveMaterial;
  recoveryCode: string;
}> {
  const pair = await generateX25519();
  const recoveryCode = recoveryCodeFromBytes(randomBytes(32));
  const material = { publicKey: bytesToB64(pair.publicKey), privateJwk: pair.privateJwk };
  return {
    material,
    recoveryCode,
    record: await createAccountArchiveKeyRecord(
      password,
      userId,
      recoveryCode,
      material,
    ),
  };
}

export async function encryptAccountArchiveDriveBackup(
  material: AccountArchiveMaterial,
  userId: string,
  recoveryCode: string,
): Promise<AccountArchiveDriveBackup> {
  validateArchiveMaterial(material);
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await deriveVaultKey(normalizedRecoveryCode(recoveryCode), salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(utf8ToBytes(driveBackupScope(userId))),
    },
    key,
    asBufferSource(utf8ToBytes(JSON.stringify(material.privateJwk))),
  ));
  return {
    format: "private-messenger-account-archive",
    version: 1,
    publicKey: material.publicKey,
    salt: bytesToB64(salt),
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(ciphertext),
  };
}

export async function decryptAccountArchiveDriveBackup(
  value: unknown,
  userId: string,
  recoveryCode: string,
): Promise<AccountArchiveMaterial> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("format" in value) ||
    !("version" in value) ||
    !("publicKey" in value) ||
    !("salt" in value) ||
    !("nonce" in value) ||
    !("ciphertext" in value)
  ) {
    throw new Error("The Google Drive archive backup has an invalid format.");
  }
  const backup = value as AccountArchiveDriveBackup;
  if (
    backup.format !== "private-messenger-account-archive" ||
    backup.version !== 1 ||
    typeof backup.publicKey !== "string" ||
    typeof backup.salt !== "string" ||
    typeof backup.nonce !== "string" ||
    typeof backup.ciphertext !== "string" ||
    backup.publicKey.length > 128 ||
    backup.salt.length > 64 ||
    backup.nonce.length > 64 ||
    backup.ciphertext.length > 4096
  ) {
    throw new Error("The Google Drive archive backup has an unsupported format.");
  }

  const salt = b64ToBytes(backup.salt);
  const nonce = b64ToBytes(backup.nonce);
  const ciphertext = b64ToBytes(backup.ciphertext);
  if (
    salt.length !== 16 ||
    nonce.length !== 12 ||
    ciphertext.length < 16 ||
    b64ToBytes(backup.publicKey).length !== 32
  ) {
    throw new Error("The Google Drive archive backup is damaged.");
  }

  let privateJwk: JsonWebKey;
  try {
    const key = await deriveVaultKey(normalizedRecoveryCode(recoveryCode), salt);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(nonce),
        additionalData: asBufferSource(utf8ToBytes(driveBackupScope(userId))),
      },
      key,
      asBufferSource(ciphertext),
    );
    privateJwk = JSON.parse(new TextDecoder().decode(plaintext)) as JsonWebKey;
  } catch (error) {
    throw new Error("The recovery code could not decrypt this Google Drive backup.", {
      cause: error,
    });
  }
  const material = { publicKey: backup.publicKey, privateJwk };
  validateArchiveMaterial(material);
  return material;
}

export async function unlockAccountArchiveKey(
  password: string,
  userId: string,
  record: AccountArchiveKeyRecord,
  recoveryCode?: string,
): Promise<{ material: AccountArchiveMaterial; passwordWrap?: WrappedValue }> {
  let privateJwk: JsonWebKey;
  let passwordWrap: WrappedValue | undefined;
  try {
    privateJwk = await decryptPrivateKey(password, userId, "password", {
      salt: record.passwordSalt,
      nonce: record.passwordNonce,
      ciphertext: record.passwordEncryptedPrivateKey,
    });
  } catch (error) {
    if (!recoveryCode) {
      throw new Error("ARCHIVE_RECOVERY_CODE_REQUIRED", { cause: error });
    }
    try {
      privateJwk = await decryptPrivateKey(recoveryCode, userId, "recovery", {
        salt: record.recoverySalt,
        nonce: record.recoveryNonce,
        ciphertext: record.recoveryEncryptedPrivateKey,
      });
    } catch (recoveryError) {
      throw new Error("INVALID_ARCHIVE_RECOVERY_CODE", { cause: recoveryError });
    }
    passwordWrap = await encryptPrivateKey(password, userId, "password", privateJwk);
  }

  const material = { publicKey: record.publicKey, privateJwk };
  validateArchiveMaterial(material);
  return {
    material,
    ...(passwordWrap ? { passwordWrap } : {}),
  };
}

export async function encryptArchiveMessage(
  ownerUserId: string,
  conversationId: string,
  logicalMessageId: string,
  plaintext: string,
  recipientPublicKey: string,
): Promise<ArchiveEnvelope> {
  const ephemeral = await generateX25519();
  const aad = archiveMessageScope(ownerUserId, conversationId, logicalMessageId);
  const key = await deriveArchiveMessageKey(
    await dh(ephemeral.privateJwk, b64ToBytes(recipientPublicKey)),
    aad,
  );
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(utf8ToBytes(aad)),
    },
    key,
    asBufferSource(utf8ToBytes(plaintext)),
  ));
  return {
    ownerUserId,
    recipientPublicKey,
    ephemeralPublicKey: bytesToB64(ephemeral.publicKey),
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(ciphertext),
  };
}

export async function decryptArchiveMessage(
  material: AccountArchiveMaterial,
  ownerUserId: string,
  conversationId: string,
  logicalMessageId: string,
  envelope: Pick<ArchiveEnvelope, "ephemeralPublicKey" | "nonce" | "ciphertext">,
) {
  const aad = archiveMessageScope(ownerUserId, conversationId, logicalMessageId);
  const key = await deriveArchiveMessageKey(
    await dh(material.privateJwk, b64ToBytes(envelope.ephemeralPublicKey)),
    aad,
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(b64ToBytes(envelope.nonce)),
      additionalData: asBufferSource(utf8ToBytes(aad)),
    },
    key,
    asBufferSource(b64ToBytes(envelope.ciphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

function archiveMessageScope(ownerUserId: string, conversationId: string, logicalMessageId: string) {
  return `private-messenger/account-archive-message/v1:${ownerUserId}:${conversationId}:${logicalMessageId}`;
}

async function deriveArchiveMessageKey(sharedSecret: Uint8Array, aad: string) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    asBufferSource(sharedSecret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asBufferSource(new Uint8Array(32)),
      info: asBufferSource(utf8ToBytes(`private-messenger/account-archive-message-key/v1:${aad}`)),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function archivePasswordWrapRecord(wrap: WrappedValue) {
  return {
    passwordSalt: wrap.salt,
    passwordNonce: wrap.nonce,
    passwordEncryptedPrivateKey: wrap.ciphertext,
  };
}

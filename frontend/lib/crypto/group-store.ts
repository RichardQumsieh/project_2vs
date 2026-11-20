import {
  encodeSessionState,
  GroupCryptoError,
  sessionFromEncodedState,
  type GroupDevice,
  type GroupRole,
  type GroupSession,
  type PublishedKeyPackage,
} from "./group-mls";
import { decodeMlsMessage } from "ts-mls/message.js";
import { asBufferSource, b64ToBytes, bytesToB64, bytesToUtf8, randomBytes, utf8ToBytes } from "./bytes";

/**
 * MLS ClientState contains leaf private keys. It is sealed with the same
 * password-derived AES-GCM vault key that encrypts the 1:1 identity vault
 * and device-recovery records, then stored in IndexedDB. The ciphertext is
 * bound to the user and conversation, so a copy cannot be opened for a
 * different account or group.
 */

export type GroupOutboxItem = {
  clientId: string;
  kind: "key_package" | "welcome" | "commit" | "proposal" | "application";
  payload: Uint8Array;
  recipientDeviceId?: string;
  bindingSignature?: Uint8Array;
  /** Present only inside the encrypted record, so a restart can show the sender's own message. */
  plaintext?: string;
};

export type GroupRecord = {
  device: GroupDevice;
  session: GroupSession | null;
  appliedBlobIds: string[];
  keyPackages: PublishedKeyPackage[];
  outbox: GroupOutboxItem[];
};

export type SealedGroupRecord = {
  nonce: string;
  ciphertext: string;
};

type StoredMeta = {
  userId: string;
  deviceId: string;
  role: GroupRole;
  trusted: string[];
  appliedBlobIds: string[];
  keyPackages: PublishedKeyPackage[];
  outbox: Array<{
    clientId: string;
    kind: GroupOutboxItem["kind"];
    payload: string;
    recipientDeviceId?: string;
    bindingSignature?: string;
    plaintext?: string;
  }>;
  hasSession: boolean;
};

function scope(userId: string, conversationId: string) {
  return utf8ToBytes(`private-messenger/group-mls/v1:${userId}:${conversationId}`);
}

function frame(chunks: Uint8Array[]): Uint8Array {
  const size = 4 + chunks.reduce((sum, chunk) => sum + 4 + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, 1);
  let offset = 4;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.byteLength);
    offset += 4;
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function unframe(bytes: Uint8Array): Uint8Array[] {
  if (bytes.byteLength < 4) throw new GroupCryptoError("Stored group record is malformed", "invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 1) throw new GroupCryptoError("Stored group record is malformed", "invalid");
  const chunks: Uint8Array[] = [];
  let offset = 4;
  while (offset < bytes.byteLength) {
    if (offset + 4 > bytes.byteLength) {
      throw new GroupCryptoError("Stored group record is malformed", "invalid");
    }
    const length = view.getUint32(offset);
    offset += 4;
    if (offset + length > bytes.byteLength) {
      throw new GroupCryptoError("Stored group record is malformed", "invalid");
    }
    chunks.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  return chunks;
}

function deviceFromParts(
  meta: StoredMeta,
  signingPublicKey: Uint8Array,
  initPrivateKey: Uint8Array,
  hpkePrivateKey: Uint8Array,
  signaturePrivateKey: Uint8Array,
  keyPackageWire: Uint8Array,
  bindingSignature: Uint8Array,
): GroupDevice {
  const decoded = decodeMlsMessage(keyPackageWire, 0);
  if (!decoded || decoded[1] !== keyPackageWire.byteLength || decoded[0].wireformat !== "mls_key_package") {
    throw new GroupCryptoError("Stored key package is malformed", "invalid");
  }
  return {
    ref: { userId: meta.userId, deviceId: meta.deviceId },
    role: meta.role,
    sophiaSigningPublicKey: signingPublicKey,
    keyPackageWire,
    bindingSignature,
    publicPackage: decoded[0].keyPackage,
    privatePackage: { initPrivateKey, hpkePrivateKey, signaturePrivateKey },
  };
}

export function encodeGroupRecord(record: GroupRecord): Uint8Array {
  const meta: StoredMeta = {
    userId: record.device.ref.userId,
    deviceId: record.device.ref.deviceId,
    role: record.device.role,
    trusted: record.session ? [...record.session.trustedKeyPackages] : [],
    appliedBlobIds: record.appliedBlobIds,
    keyPackages: record.keyPackages,
    outbox: record.outbox.map((item) => ({
      clientId: item.clientId,
      kind: item.kind,
      payload: bytesToB64(item.payload),
      ...(item.recipientDeviceId ? { recipientDeviceId: item.recipientDeviceId } : {}),
      ...(item.bindingSignature ? { bindingSignature: bytesToB64(item.bindingSignature) } : {}),
      ...(item.plaintext !== undefined ? { plaintext: item.plaintext } : {}),
    })),
    hasSession: record.session !== null,
  };
  const priv = record.device.privatePackage;
  return frame([
    record.session ? encodeSessionState(record.session) : new Uint8Array(),
    utf8ToBytes(JSON.stringify(meta)),
    record.device.sophiaSigningPublicKey,
    priv.initPrivateKey,
    priv.hpkePrivateKey,
    priv.signaturePrivateKey,
    record.device.keyPackageWire,
    record.device.bindingSignature,
  ]);
}

export function decodeGroupRecord(bytes: Uint8Array): GroupRecord {
  const chunks = unframe(bytes);
  if (chunks.length !== 8) throw new GroupCryptoError("Stored group record is malformed", "invalid");
  const [
    stateBytes,
    metaBytes,
    signingPublicKey,
    initPrivateKey,
    hpkePrivateKey,
    signaturePrivateKey,
    keyPackageWire,
    bindingSignature,
  ] = chunks as [
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
  ];
  let meta: StoredMeta;
  try {
    meta = JSON.parse(bytesToUtf8(metaBytes)) as StoredMeta;
  } catch {
    throw new GroupCryptoError("Stored group record is malformed", "invalid");
  }
  const device = deviceFromParts(
    meta,
    signingPublicKey,
    initPrivateKey,
    hpkePrivateKey,
    signaturePrivateKey,
    keyPackageWire,
    bindingSignature,
  );
  const session = meta.hasSession
    ? sessionFromEncodedState(device, stateBytes, meta.trusted ?? [])
    : null;
  return {
    device,
    session,
    appliedBlobIds: meta.appliedBlobIds ?? [],
    keyPackages: meta.keyPackages ?? [],
    outbox: (meta.outbox ?? []).map((item) => ({
      clientId: item.clientId,
      kind: item.kind,
      payload: b64ToBytes(item.payload),
      ...(item.recipientDeviceId ? { recipientDeviceId: item.recipientDeviceId } : {}),
      ...(item.bindingSignature ? { bindingSignature: b64ToBytes(item.bindingSignature) } : {}),
      ...(item.plaintext !== undefined ? { plaintext: item.plaintext } : {}),
    })),
  };
}

export async function sealGroupRecord(
  key: CryptoKey,
  userId: string,
  conversationId: string,
  record: GroupRecord,
): Promise<SealedGroupRecord> {
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asBufferSource(nonce),
      additionalData: asBufferSource(scope(userId.toLowerCase(), conversationId.toLowerCase())),
    },
    key,
    asBufferSource(encodeGroupRecord(record)),
  ));
  return { nonce: bytesToB64(nonce), ciphertext: bytesToB64(ciphertext) };
}

export async function openGroupRecord(
  key: CryptoKey,
  userId: string,
  conversationId: string,
  sealed: SealedGroupRecord,
): Promise<GroupRecord> {
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(b64ToBytes(sealed.nonce)),
        additionalData: asBufferSource(scope(userId.toLowerCase(), conversationId.toLowerCase())),
      },
      key,
      asBufferSource(b64ToBytes(sealed.ciphertext)),
    );
  } catch {
    throw new GroupCryptoError("Could not open the stored group with this vault key", "cannot_decrypt");
  }
  return decodeGroupRecord(new Uint8Array(plaintext));
}

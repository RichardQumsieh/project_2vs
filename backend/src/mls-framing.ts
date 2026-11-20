/**
 * Public MLS (RFC 9420) framing only.
 *
 * Private-message ciphertext, Welcome secrets, and key-package private keys
 * are never decoded. The bytes we read are the version, wire format, group id,
 * epoch, and content type that MLS leaves in the clear. Message plaintext is
 * inside the ciphertext and is not inspected.
 */

const MLS10 = 1;
const WIRE_PRIVATE = 2;
const WIRE_WELCOME = 3;
const WIRE_KEY_PACKAGE = 5;
const SUITE_128_DHKEMX25519 = 1;
const CONTENT_APPLICATION = 1;
const CONTENT_PROPOSAL = 2;
const CONTENT_COMMIT = 3;
const MAX_EPOCH = 2_147_483_647;

export type MlsContentType = "application" | "proposal" | "commit";

export type PublicMlsHeader =
  | { shape: "key_package" }
  | { shape: "welcome" }
  | {
      shape: "private";
      groupId: Uint8Array;
      epoch: number;
      contentType: MlsContentType;
    };

type Reader = { bytes: Uint8Array; offset: number };

function readUint8(reader: Reader): number | null {
  const value = reader.bytes[reader.offset];
  if (value === undefined) return null;
  reader.offset += 1;
  return value;
}

function readUint16(reader: Reader): number | null {
  if (reader.offset + 2 > reader.bytes.length) return null;
  const value = (reader.bytes[reader.offset]! << 8) | reader.bytes[reader.offset + 1]!;
  reader.offset += 2;
  return value;
}

function readUint64(reader: Reader): bigint | null {
  if (reader.offset + 8 > reader.bytes.length) return null;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(reader.bytes[reader.offset + index]!);
  }
  reader.offset += 8;
  return value;
}

function readFixed(reader: Reader, length: number): true | null {
  if (length < 0 || reader.offset + length > reader.bytes.length) return null;
  reader.offset += length;
  return true;
}

function readVlBytes(reader: Reader): Uint8Array | null {
  if (reader.offset >= reader.bytes.length) return null;
  const first = reader.bytes[reader.offset]!;
  const prefix = first >> 6;
  let length = 0;
  let width = 0;
  if (prefix === 0) {
    length = first & 0x3f;
    width = 1;
  } else if (prefix === 1) {
    if (reader.offset + 2 > reader.bytes.length) return null;
    length = ((first & 0x3f) << 8) | reader.bytes[reader.offset + 1]!;
    width = 2;
  } else if (prefix === 2) {
    if (reader.offset + 4 > reader.bytes.length) return null;
    length =
      ((first & 0x3f) << 24) |
      (reader.bytes[reader.offset + 1]! << 16) |
      (reader.bytes[reader.offset + 2]! << 8) |
      reader.bytes[reader.offset + 3]!;
    width = 4;
  } else {
    return null;
  }
  const start = reader.offset + width;
  const end = start + length;
  if (end > reader.bytes.length) return null;
  reader.offset = end;
  return reader.bytes.subarray(start, end);
}

function skipCredential(reader: Reader): true | null {
  if (readUint16(reader) === null) return null;
  return readVlBytes(reader) ? true : null;
}

function skipCapabilities(reader: Reader): true | null {
  for (let index = 0; index < 5; index += 1) {
    if (!readVlBytes(reader)) return null;
  }
  return true;
}

function skipLeafNode(reader: Reader): true | null {
  if (!readVlBytes(reader) || !readVlBytes(reader)) return null;
  if (!skipCredential(reader) || !skipCapabilities(reader)) return null;
  const source = readUint8(reader);
  if (source === 1) {
    if (!readFixed(reader, 16) || !readVlBytes(reader)) return null;
  } else if (source === 2) {
    if (!readVlBytes(reader)) return null;
  } else if (source === 3) {
    if (!readVlBytes(reader) || !readVlBytes(reader)) return null;
  } else {
    return null;
  }
  const signature = readVlBytes(reader);
  if (!signature || signature.byteLength === 0) return null;
  return true;
}

function readPrivate(reader: Reader): PublicMlsHeader | null {
  const groupId = readVlBytes(reader);
  const epoch = readUint64(reader);
  const contentType = readUint8(reader);
  const authenticatedData = readVlBytes(reader);
  const encryptedSender = readVlBytes(reader);
  const ciphertext = readVlBytes(reader);
  if (
    !groupId ||
    groupId.byteLength === 0 ||
    groupId.byteLength > 64 ||
    epoch === null ||
    epoch > BigInt(MAX_EPOCH) ||
    authenticatedData === null ||
    !encryptedSender ||
    encryptedSender.byteLength === 0 ||
    !ciphertext ||
    ciphertext.byteLength === 0
  ) {
    return null;
  }
  const named =
    contentType === CONTENT_APPLICATION
      ? "application"
      : contentType === CONTENT_PROPOSAL
        ? "proposal"
        : contentType === CONTENT_COMMIT
          ? "commit"
          : null;
  if (!named) return null;
  return { shape: "private", groupId, epoch: Number(epoch), contentType: named };
}

function readWelcome(reader: Reader): PublicMlsHeader | null {
  const suite = readUint16(reader);
  const secrets = readVlBytes(reader);
  const groupInfo = readVlBytes(reader);
  if (suite !== SUITE_128_DHKEMX25519 || !secrets || secrets.byteLength === 0 || !groupInfo || groupInfo.byteLength === 0) {
    return null;
  }
  return { shape: "welcome" };
}

function readKeyPackage(reader: Reader): PublicMlsHeader | null {
  const version = readUint16(reader);
  const suite = readUint16(reader);
  const initKey = readVlBytes(reader);
  if (version !== MLS10 || suite !== SUITE_128_DHKEMX25519 || !initKey || initKey.byteLength === 0) return null;
  if (!skipLeafNode(reader)) return null;
  const extensions = readVlBytes(reader);
  const signature = readVlBytes(reader);
  if (!extensions || !signature || signature.byteLength === 0) return null;
  return { shape: "key_package" };
}

/**
 * Returns the public header when the buffer is exactly one well-formed MLS
 * message. Returns null for truncation, trailing bytes, or a wire format this
 * server refuses. Does not return plaintext.
 */
export function readPublicMlsHeader(bytes: Uint8Array): PublicMlsHeader | null {
  const reader: Reader = { bytes, offset: 0 };
  const version = readUint16(reader);
  const wire = readUint16(reader);
  if (version !== MLS10 || wire === null) return null;
  let header: PublicMlsHeader | null = null;
  if (wire === WIRE_PRIVATE) header = readPrivate(reader);
  else if (wire === WIRE_WELCOME) header = readWelcome(reader);
  else if (wire === WIRE_KEY_PACKAGE) header = readKeyPackage(reader);
  else return null;
  if (!header || reader.offset !== bytes.length) return null;
  return header;
}

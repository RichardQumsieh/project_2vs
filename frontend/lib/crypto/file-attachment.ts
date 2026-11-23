import { asBufferSource, b64ToBytes, bytesToB64, randomBytes } from "./bytes";
import {
  allowedFileAttachmentTypes,
  maxEncryptedFileAttachmentBytes,
  maxFileAttachmentBytes,
} from "../chat-payload";

export type AllowedFileAttachmentMime = (typeof allowedFileAttachmentTypes)[number];

export type EncryptedFileAttachment = {
  ciphertext: Uint8Array;
  key: string;
  nonce: string;
  mime: AllowedFileAttachmentMime;
  name: string;
  containsExternalLinks: boolean;
};

export { maxEncryptedFileAttachmentBytes, maxFileAttachmentBytes } from "../chat-payload";

const mimeByExtension: Record<string, AllowedFileAttachmentMime> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const officeDocuments = {
  docx: {
    mainEntry: "word/document.xml",
    mainType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  pptx: {
    mainEntry: "ppt/presentation.xml",
    mainType: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
  xlsx: {
    mainEntry: "xl/workbook.xml",
    mainType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
} as const;

const maxZipEntries = 4096;
const maxOfficeXmlBytes = 1024 * 1024;
const maxOfficeUncompressedBytes = 450_000_000;

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  centralOffset: number;
};

export function sanitizeAttachmentName(name: string) {
  const nameParts = name.split(/[\\/]/);
  const baseName = nameParts[nameParts.length - 1] ?? "";
  if (baseName.startsWith(".")) {
    throw new Error("Choose a file with a safe name and an allowed extension.");
  }
  const cleaned = baseName
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/^[ .]+|[ .]+$/g, "")
    .slice(0, 255);
  if (!cleaned || cleaned.startsWith(".")) {
    throw new Error("Choose a file with a safe name and an allowed extension.");
  }
  const extensionParts = cleaned.split(".");
  const extension = extensionParts[extensionParts.length - 1]?.toLowerCase();
  if (!extension || !mimeByExtension[extension]) {
    throw new Error("Allowed files: PDF, DOCX, PPTX, XLSX, TXT, and CSV.");
  }
  return cleaned;
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView) {
  const lowerBound = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  throw new Error("This Office file has an invalid or unsupported ZIP structure.");
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes, view);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entryCount > maxZipEntries ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new Error("This Office file uses an unsupported or unsafe ZIP structure.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const seen = new Set<string>();
  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("This Office file has a damaged ZIP directory.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nextOffset = nameStart + nameLength + extraLength + commentLength;
    if (
      nextOffset > endOffset ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new Error("This Office file uses an unsupported ZIP64 structure.");
    }
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const normalizedName = name.replace(/\\/g, "/");
    const components = normalizedName.split("/");
    const unixMode = externalAttributes >>> 16;
    if (
      normalizedName.startsWith("/") ||
      normalizedName.includes(":") ||
      components.some((part) => part === "..") ||
      seen.has(normalizedName) ||
      (unixMode & 0xf000) === 0xa000 ||
      (flags & 0x0001) !== 0 ||
      (method !== 0 && method !== 8)
    ) {
      throw new Error("This Office file contains unsafe or unsupported ZIP entries.");
    }
    seen.add(normalizedName);
    totalUncompressed += uncompressedSize;
    if (
      totalUncompressed > maxOfficeUncompressedBytes ||
      (compressedSize === 0 && uncompressedSize > 0) ||
      (compressedSize > 0 && uncompressedSize / compressedSize > 1000)
    ) {
      throw new Error("This Office file exceeds safe archive expansion limits.");
    }
    entries.push({
      name: normalizedName,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
      centralOffset,
    });
    offset = nextOffset;
  }
  if (offset !== endOffset) {
    throw new Error("This Office file has extra or malformed ZIP directory data.");
  }
  return entries;
}

async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  maxOutputBytes: number,
) {
  if (entry.uncompressedSize > maxOutputBytes) {
    throw new Error("This Office file contains oversized document metadata.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = entry.localOffset;
  const localNameLength = localOffset + 30 <= bytes.byteLength
    ? view.getUint16(localOffset + 26, true)
    : 0;
  const localExtraLength = localOffset + 30 <= bytes.byteLength
    ? view.getUint16(localOffset + 28, true)
    : 0;
  const localNameStart = localOffset + 30;
  const localName = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(localNameStart, localNameStart + localNameLength),
  );
  if (
    localOffset + 30 > bytes.byteLength ||
    view.getUint32(localOffset, true) !== 0x04034b50
  ) {
    throw new Error("This Office file has an invalid ZIP entry.");
  }
  if (
    localName !== entry.name ||
    view.getUint16(localOffset + 6, true) !== entry.flags ||
    view.getUint16(localOffset + 8, true) !== entry.method
  ) {
    throw new Error("This Office file has inconsistent ZIP entry names or flags.");
  }
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > entry.centralOffset) {
    throw new Error("This Office file has a truncated ZIP entry.");
  }
  const compressed = bytes.subarray(dataStart, dataEnd);
  if (entry.method === 0) {
    if (compressed.byteLength !== entry.uncompressedSize) {
      throw new Error("This Office file has inconsistent ZIP metadata.");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(compressed);
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot safely verify Office files. Try an up-to-date browser.");
  }
  const stream = new Blob([asBufferSource(compressed)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxOutputBytes) {
        await reader.cancel();
        throw new Error("This Office file contains oversized document metadata.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== entry.uncompressedSize) {
    throw new Error("This Office file has inconsistent ZIP metadata.");
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(output);
}

function rejectActiveOfficeContent(entries: ZipEntry[]) {
  const forbiddenPath = /(?:^|\/)(?:vbaproject\.bin|activex|embeddings|externallinks)(?:\/|$)|\.(?:exe|dll|js|mjs|vbs|ps1|bat|cmd|com|scr|hta|msi|jar|lnk)$/i;
  if (entries.some((entry) => forbiddenPath.test(entry.name))) {
    throw new Error("Macro-enabled files, embedded objects, and executable content are not allowed.");
  }
}

async function inspectOfficeFile(bytes: Uint8Array, extension: keyof typeof officeDocuments) {
  const entries = readZipEntries(bytes);
  rejectActiveOfficeContent(entries);
  const contentTypes = entries.find((entry) => entry.name === "[Content_Types].xml");
  const main = officeDocuments[extension];
  if (!contentTypes || !entries.some((entry) => entry.name === main.mainEntry)) {
    throw new Error(`The file contents do not match a valid .${extension.toUpperCase()} document.`);
  }
  const contentTypesXml = await readZipEntry(bytes, contentTypes, maxOfficeXmlBytes);
  if (!contentTypesXml.includes(main.mainType)) {
    throw new Error(`The file contents do not match a valid .${extension.toUpperCase()} document.`);
  }

  let containsExternalLinks = false;
  for (const entry of entries) {
    if (!entry.name.endsWith(".rels")) continue;
    const relationships = await readZipEntry(bytes, entry, maxOfficeXmlBytes);
    if (/<Relationship\b[^>]*\bTargetMode\s*=\s*["']External["']/i.test(relationships)) {
      containsExternalLinks = true;
      break;
    }
  }
  return containsExternalLinks;
}

function hasPdfSignature(bytes: Uint8Array) {
  const header = new TextDecoder().decode(bytes.subarray(0, 8));
  const tail = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  return header.startsWith("%PDF-") && tail.includes("%%EOF");
}

function validateTextFile(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.includes(0)) {
    throw new Error("This file is not safe plain text.");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: true });
  } catch {
    throw new Error("Plain text and CSV attachments must use UTF-8 encoding.");
  }
}

export async function inspectAndEncryptFileAttachment(file: File): Promise<EncryptedFileAttachment> {
  if (file.size === 0 || file.size > maxFileAttachmentBytes) {
    throw new Error("Files must be non-empty and 450 MB or smaller.");
  }
  const name = sanitizeAttachmentName(file.name);
  const extensionParts = name.split(".");
  const extension = extensionParts[extensionParts.length - 1]!.toLowerCase();
  const mime = mimeByExtension[extension];
  const fileBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(fileBuffer);
  if (bytes.byteLength !== file.size) {
    throw new Error("The selected file could not be read completely.");
  }

  let containsExternalLinks = false;
  if (extension === "pdf") {
    if (!hasPdfSignature(bytes)) {
      throw new Error("The file contents do not match a valid PDF document.");
    }
  } else if (extension === "txt" || extension === "csv") {
    validateTextFile(bytes);
  } else {
    containsExternalLinks = await inspectOfficeFile(
      bytes,
      extension as keyof typeof officeDocuments,
    );
  }

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(nonce) },
      key,
      fileBuffer,
    ),
  );
  if (ciphertext.byteLength > maxEncryptedFileAttachmentBytes) {
    throw new Error("The encrypted file exceeds the 450 MB attachment limit.");
  }
  return {
    ciphertext,
    key: bytesToB64(new Uint8Array(await crypto.subtle.exportKey("raw", key))),
    nonce: bytesToB64(nonce),
    mime,
    name,
    containsExternalLinks,
  };
}

export async function decryptFileAttachment(
  ciphertext: ArrayBuffer,
  keyB64: string,
  nonceB64: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(b64ToBytes(keyB64)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(b64ToBytes(nonceB64)) },
    key,
    ciphertext,
  );
  return new Blob([plaintext], { type: "application/octet-stream" });
}

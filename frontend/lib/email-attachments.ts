/**
 * Outbound mail attachments. Limits match the API in
 * backend/src/integrations/email-write.ts: 5 files, 1.5 MB each,
 * 2 MB decoded total, so the JSON body stays under the route limit
 * and Outlook's sendMail request cap.
 */
export const maxEmailAttachmentBytes = 1_500_000;
export const maxEmailAttachmentCount = 5;
export const maxEmailAttachmentTotalBytes = 2_000_000;

export type OutboundEmailAttachment = {
  filename: string;
  contentType: string;
  size: number;
  contentBase64: string;
};

const typesByExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
};

const extensionsByType: Record<string, readonly string[]> = {};
for (const [extension, contentType] of Object.entries(typesByExtension)) {
  const list = extensionsByType[contentType] ?? [];
  extensionsByType[contentType] = [...list, extension];
}

const scriptMarkers = ["<script", "javascript:", "vbaproject.bin", "/javascript"];

export function formatAttachmentSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.round(bytes))} B`;
  }
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array | null {
  if (
    value.length === 0 ||
    value.length > 2_800_000 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return null;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (bytesToBase64(bytes).replace(/=+$/, "") !== value.replace(/=+$/, "")) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (bytes.length < offset + length) {
    return "";
  }
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return text;
}

export function attachmentMagicMatches(contentType: string, bytes: Uint8Array) {
  switch (contentType) {
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
    case "image/webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
    case "application/pdf":
      return ascii(bytes, 0, 5) === "%PDF-";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
    default:
      return false;
  }
}

export function attachmentContainsScript(bytes: Uint8Array) {
  let text = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    text += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  const lower = text.toLowerCase();
  return scriptMarkers.some((marker) => lower.includes(marker));
}

export function attachmentFilename(name: string, contentType: string) {
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (
    !base ||
    base.length > 120 ||
    base === "." ||
    base === ".." ||
    base.startsWith(".") ||
    /[\u0000-\u001f\u007f]/.test(base) ||
    /[\\/<>:"|?*]/.test(base)
  ) {
    return null;
  }
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(base)?.[1]?.toLowerCase();
  const allowed = extension ? extensionsByType[contentType] : undefined;
  if (!extension || !allowed?.includes(extension)) {
    return null;
  }
  return base;
}

function contentTypeForFile(file: File) {
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(file.name)?.[1]?.toLowerCase();
  const fromName = extension ? typesByExtension[extension] : undefined;
  const declared = file.type.trim().toLowerCase();
  if (!declared || declared === "application/octet-stream") {
    return fromName ?? null;
  }
  const normalized = declared === "image/jpg" ? "image/jpeg" : declared;
  if (!extensionsByType[normalized] || (fromName && fromName !== normalized)) {
    return null;
  }
  return normalized;
}

export function validateOutboundAttachments(
  value: readonly OutboundEmailAttachment[] | undefined,
):
  | { ok: true; attachments: OutboundEmailAttachment[] }
  | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, attachments: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: "Attachments must be a list of files." };
  }
  if (value.length > maxEmailAttachmentCount) {
    return { ok: false, error: "You can attach up to 5 files." };
  }
  const attachments: OutboundEmailAttachment[] = [];
  let total = 0;
  for (const item of value) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.filename !== "string" ||
      typeof item.contentType !== "string" ||
      typeof item.size !== "number" ||
      typeof item.contentBase64 !== "string"
    ) {
      return { ok: false, error: "An attachment is missing its file details." };
    }
    const contentType = item.contentType.trim().toLowerCase();
    const filename = attachmentFilename(item.filename, contentType);
    if (!filename || !Number.isInteger(item.size) || item.size <= 0) {
      return { ok: false, error: "Use an image, PDF, or Office document with a matching name." };
    }
    if (item.size > maxEmailAttachmentBytes) {
      return { ok: false, error: "Each attachment must be 1.5 MB or smaller." };
    }
    total += item.size;
    if (total > maxEmailAttachmentTotalBytes) {
      return { ok: false, error: "Attachments together must be 2 MB or smaller." };
    }
    const bytes = decodeBase64(item.contentBase64);
    if (!bytes || bytes.byteLength !== item.size) {
      return { ok: false, error: "An attachment could not be read." };
    }
    if (!attachmentMagicMatches(contentType, bytes) || attachmentContainsScript(bytes)) {
      return { ok: false, error: "That file type is not allowed." };
    }
    attachments.push({
      filename,
      contentType,
      size: item.size,
      contentBase64: item.contentBase64,
    });
  }
  return { ok: true, attachments };
}

export async function readEmailAttachmentFile(
  file: File,
): Promise<
  | { ok: true; attachment: OutboundEmailAttachment }
  | { ok: false; error: string }
> {
  if (file.size <= 0) {
    return { ok: false, error: "That file is empty." };
  }
  if (file.size > maxEmailAttachmentBytes) {
    return { ok: false, error: "Each attachment must be 1.5 MB or smaller." };
  }
  const contentType = contentTypeForFile(file);
  if (!contentType) {
    return { ok: false, error: "Attach an image, PDF, or Office document. Scripts are not allowed." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!attachmentMagicMatches(contentType, bytes)) {
    return { ok: false, error: "That file does not match its type." };
  }
  if (attachmentContainsScript(bytes)) {
    return { ok: false, error: "That file looks like it contains a script." };
  }
  const filename = attachmentFilename(file.name, contentType);
  if (!filename) {
    return { ok: false, error: "Use a simple filename that matches the file type." };
  }
  return {
    ok: true,
    attachment: {
      filename,
      contentType,
      size: bytes.byteLength,
      contentBase64: bytesToBase64(bytes),
    },
  };
}

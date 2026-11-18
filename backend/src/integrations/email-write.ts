import type { EmailProviderId } from "./email-providers.js";

/** Decoded limits keep the JSON body under emailWriteBodyLimit and Outlook sendMail. */
export const emailAttachmentLimits = {
  maxFiles: 5,
  maxBytesEach: 1_500_000,
  maxBytesTotal: 2_000_000,
} as const;

export const emailWriteBodyLimit = 3_500_000;

export type EmailAttachmentWrite = {
  filename: string;
  contentType: string;
  size: number;
  contentBase64: string;
};

export type EmailDraftWritePayload = {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  html?: string;
  contentType?: "text/plain" | "text/html";
  attachments?: EmailAttachmentWrite[];
};

export type EmailDraftWriteResult = {
  externalDraftId: string;
};

export type EmailSendWriteResult = {
  externalMessageId: string | null;
};

const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function clampText(value: string, max: number) {
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function escapeAttr(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeAttr(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Allow only the tags the composer emits. Drops scripts, handlers, and unsafe URLs. */
export function sanitizeEmailHtml(input: string) {
  const withoutBlocks = input
    .replace(/\u0000/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<\s*(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      "",
    );
  return withoutBlocks.replace(
    /<\/?([a-zA-Z0-9]+)([^>]*)>/g,
    (full, tag, attrs) => {
      const name = String(tag).toLowerCase();
      if (name === "br") {
        return "<br>";
      }
      if (name === "strong" || name === "em" || name === "b" || name === "i") {
        const normalized = name === "b" ? "strong" : name === "i" ? "em" : name;
        return full.startsWith("</") ? `</${normalized}>` : `<${normalized}>`;
      }
      if (name === "a") {
        if (full.startsWith("</")) {
          return "</a>";
        }
        const hrefMatch =
          /\bhref\s*=\s*"([^"]*)"/i.exec(String(attrs)) ??
          /\bhref\s*=\s*'([^']*)'/i.exec(String(attrs));
        const href = decodeAttr(hrefMatch?.[1] ?? "");
        if (!isSafeHttpUrl(href)) {
          return "";
        }
        return `<a href="${escapeAttr(href)}">`;
      }
      return "";
    },
  );
}

const attachmentTypes: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "application/msword": ["doc"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.ms-powerpoint": ["ppt"],
};

const scriptMarkers = ["<script", "javascript:", "vbaproject.bin", "/javascript"];

function startsWithBytes(bytes: Buffer, signature: readonly number[], offset = 0) {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  return signature.every((value, index) => bytes[offset + index] === value);
}

function attachmentMagicMatches(contentType: string, bytes: Buffer) {
  switch (contentType) {
    case "image/jpeg":
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif": {
      const head = bytes.subarray(0, 6).toString("ascii");
      return head === "GIF87a" || head === "GIF89a";
    }
    case "image/webp":
      return (
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case "application/pdf":
      return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
    default:
      return false;
  }
}

function decodeAttachmentBase64(value: string) {
  if (
    value.length === 0 ||
    value.length > 2_800_000 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    return null;
  }
  return decoded;
}

function attachmentFilename(name: string, contentType: string) {
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
  const allowed = extension ? attachmentTypes[contentType] : undefined;
  if (!extension || !allowed?.includes(extension)) {
    return null;
  }
  return base;
}

function parseAttachments(value: unknown):
  | { ok: true; attachments: EmailAttachmentWrite[] }
  | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, attachments: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: "attachments must be an array" };
  }
  if (value.length > emailAttachmentLimits.maxFiles) {
    return { ok: false, error: "too many attachments" };
  }
  const attachments: EmailAttachmentWrite[] = [];
  let total = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "attachment is invalid" };
    }
    const row = item as Record<string, unknown>;
    if (
      typeof row.filename !== "string" ||
      typeof row.contentType !== "string" ||
      typeof row.size !== "number" ||
      typeof row.contentBase64 !== "string"
    ) {
      return { ok: false, error: "attachment is invalid" };
    }
    const contentType = row.contentType.trim().toLowerCase();
    const filename = attachmentFilename(row.filename, contentType);
    if (!filename || !Number.isInteger(row.size) || row.size <= 0) {
      return { ok: false, error: "attachment type is not allowed" };
    }
    if (row.size > emailAttachmentLimits.maxBytesEach) {
      return { ok: false, error: "attachment is too large" };
    }
    total += row.size;
    if (total > emailAttachmentLimits.maxBytesTotal) {
      return { ok: false, error: "attachments are too large" };
    }
    const bytes = decodeAttachmentBase64(row.contentBase64);
    if (!bytes || bytes.length !== row.size) {
      return { ok: false, error: "attachment content is invalid" };
    }
    if (
      !attachmentMagicMatches(contentType, bytes) ||
      scriptMarkers.some((marker) => bytes.toString("latin1").toLowerCase().includes(marker))
    ) {
      return { ok: false, error: "attachment type is not allowed" };
    }
    attachments.push({
      filename,
      contentType,
      size: row.size,
      contentBase64: row.contentBase64,
    });
  }
  return { ok: true, attachments };
}

function isEmailAddress(value: string) {
  return (
    value.length <= 320 &&
    !/[\r\n]/.test(value) &&
    emailPattern.test(value)
  );
}

function parseAddressList(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    return { ok: false as const, error: `${field} must be an array of emails` };
  }
  const addresses: string[] = [];
  for (const item of value.slice(0, 20)) {
    if (typeof item !== "string" || !isEmailAddress(item.trim())) {
      return { ok: false as const, error: `${field} contains an invalid address` };
    }
    addresses.push(clampText(item, 320));
  }
  return { ok: true as const, addresses };
}

export function validateEmailDraftWritePayload(
  body: unknown,
):
  | { ok: true; payload: EmailDraftWritePayload }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid payload" };
  }
  const row = body as Record<string, unknown>;
  const to = parseAddressList(row.to, "to");
  if (!to.ok) {
    return to;
  }
  if (to.addresses.length === 0) {
    return { ok: false, error: "to requires at least one address" };
  }
  if (typeof row.subject !== "string" || /[\r\n]/.test(row.subject)) {
    return { ok: false, error: "subject is required" };
  }
  if (typeof row.body !== "string" || /[\u0000]/.test(row.body)) {
    return { ok: false, error: "body is required" };
  }
  let cc: string[] | undefined;
  if (row.cc !== undefined) {
    const parsedCc = parseAddressList(row.cc, "cc");
    if (!parsedCc.ok) {
      return parsedCc;
    }
    cc = parsedCc.addresses;
  }
  let html: string | undefined;
  if (row.html !== undefined) {
    if (typeof row.html !== "string") {
      return { ok: false, error: "html must be a string" };
    }
    const sanitized = sanitizeEmailHtml(row.html).slice(0, 40_000);
    if (sanitized.trim()) {
      html = sanitized;
    }
  }
  const attachments = parseAttachments(row.attachments);
  if (!attachments.ok) {
    return attachments;
  }
  return {
    ok: true,
    payload: {
      to: to.addresses,
      subject: clampText(row.subject, 500),
      body: clampText(row.body, 20_000),
      cc,
      ...(html
        ? { html, contentType: "text/html" as const }
        : { contentType: "text/plain" as const }),
      ...(attachments.attachments.length > 0
        ? { attachments: attachments.attachments }
        : {}),
    },
  };
}

function encodeMimeHeader(value: string) {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

const altBoundarySeed = "sophia_alt_b7e1c4";
const mixedBoundarySeed = "sophia_mix_4f91c2";

function uniqueBoundary(seed: string, parts: readonly string[]) {
  let boundary = seed;
  const haystack = parts.join("\n");
  while (haystack.includes(boundary)) {
    boundary += "x";
  }
  return boundary;
}

function wrapBase64(value: string) {
  const lines: string[] = [];
  for (let index = 0; index < value.length; index += 76) {
    lines.push(value.slice(index, index + 76));
  }
  return lines.join("\r\n");
}

function bodyPart(payload: EmailDraftWritePayload) {
  if (!payload.html) {
    return [
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      payload.body,
    ].join("\r\n");
  }
  const boundary = uniqueBoundary(altBoundarySeed, [payload.body, payload.html]);
  const plain = payload.body.split(boundary).join(" ");
  const html = payload.html.split(boundary).join(" ");
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    plain,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
    `--${boundary}--`,
  ].join("\r\n");
}

function buildRfc822(payload: EmailDraftWritePayload) {
  const headers = [
    `To: ${payload.to.join(", ")}`,
    ...(payload.cc && payload.cc.length > 0
      ? [`Cc: ${payload.cc.join(", ")}`]
      : []),
    `Subject: ${encodeMimeHeader(payload.subject)}`,
    "MIME-Version: 1.0",
  ];
  const message = bodyPart(payload);
  const files = payload.attachments ?? [];
  if (files.length === 0) {
    if (payload.html) {
      return [...headers, message, ""].join("\r\n");
    }
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      payload.body,
    ].join("\r\n");
  }
  const boundary = uniqueBoundary(mixedBoundarySeed, [
    message,
    ...files.map((file) => file.contentBase64),
  ]);
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    message,
  ];
  for (const file of files) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${file.contentType}; name="${file.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${file.filename}"`,
      "",
      wrapBase64(file.contentBase64),
    );
  }
  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function outlookBody(payload: EmailDraftWritePayload) {
  return payload.html
    ? { contentType: "HTML", content: payload.html }
    : { contentType: "Text", content: payload.body };
}

function outlookRecipients(payload: EmailDraftWritePayload) {
  return {
    subject: payload.subject,
    body: outlookBody(payload),
    toRecipients: payload.to.map((address) => ({
      emailAddress: { address },
    })),
    ccRecipients: (payload.cc ?? []).map((address) => ({
      emailAddress: { address },
    })),
    ...((payload.attachments ?? []).length > 0
      ? {
          attachments: payload.attachments!.map((file) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: file.filename,
            contentType: file.contentType,
            contentBytes: file.contentBase64,
          })),
        }
      : {}),
  };
}

export function buildEmailDraftCreateRequest(
  provider: EmailProviderId,
  payload: EmailDraftWritePayload,
) {
  if (provider === "gmail") {
    return {
      url: "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      method: "POST" as const,
      body: {
        message: {
          raw: toBase64Url(buildRfc822(payload)),
        },
      },
    };
  }
  return {
    url: "https://graph.microsoft.com/v1.0/me/messages",
    method: "POST" as const,
    body: {
      ...outlookRecipients(payload),
      isDraft: true,
    },
  };
}

export function buildEmailSendRequest(
  provider: EmailProviderId,
  payload: EmailDraftWritePayload,
) {
  if (provider === "gmail") {
    return {
      url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      method: "POST" as const,
      body: {
        raw: toBase64Url(buildRfc822(payload)),
      },
    };
  }
  return {
    url: "https://graph.microsoft.com/v1.0/me/sendMail",
    method: "POST" as const,
    body: {
      message: outlookRecipients(payload),
      saveToSentItems: true,
    },
  };
}

export function parseEmailDraftWriteResult(
  provider: EmailProviderId,
  payload: unknown,
): EmailDraftWriteResult | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) {
    return null;
  }
  return { externalDraftId: row.id.slice(0, 200) };
}

export function parseEmailSendResult(
  provider: EmailProviderId,
  payload: unknown,
  status: number,
): EmailSendWriteResult | null {
  if (provider === "outlook-mail") {
    if (status === 200 || status === 202 || status === 204) {
      return { externalMessageId: null };
    }
    return null;
  }
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) {
    return null;
  }
  return { externalMessageId: row.id.slice(0, 200) };
}

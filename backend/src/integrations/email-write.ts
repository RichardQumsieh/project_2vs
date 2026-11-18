import type { EmailProviderId } from "./email-providers.js";

export type EmailDraftWritePayload = {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  html?: string;
  contentType?: "text/plain" | "text/html";
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
    },
  };
}

function encodeMimeHeader(value: string) {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

const mimeBoundary = "sophia_alt_b7e1c4";

function buildRfc822(payload: EmailDraftWritePayload) {
  const headers = [
    `To: ${payload.to.join(", ")}`,
    ...(payload.cc && payload.cc.length > 0
      ? [`Cc: ${payload.cc.join(", ")}`]
      : []),
    `Subject: ${encodeMimeHeader(payload.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (payload.html) {
    const plain = payload.body.split(mimeBoundary).join(" ");
    const html = payload.html.split(mimeBoundary).join(" ");
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${mimeBoundary}"`,
      "",
      `--${mimeBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      plain,
      `--${mimeBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "",
      html,
      `--${mimeBoundary}--`,
      "",
    ].join("\r\n");
  }
  return [
    ...headers,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    payload.body,
  ].join("\r\n");
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

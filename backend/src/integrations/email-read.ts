import { clampPlainText, htmlToPlainText } from "./plain-text.js";

export type MailBody = {
  text: string;
  truncated: boolean;
};

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

function decodeBase64Url(data: string) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad =
    normalized.length % 4 === 0
      ? ""
      : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, "base64").toString("utf8");
}

function collectText(part: GmailPart | undefined, mime: string, out: string[]) {
  if (!part || typeof part !== "object") {
    return;
  }
  const filename = typeof part.filename === "string" ? part.filename.trim() : "";
  if (
    !filename &&
    part.mimeType === mime &&
    typeof part.body?.data === "string" &&
    part.body.data
  ) {
    out.push(decodeBase64Url(part.body.data));
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      collectText(child, mime, out);
    }
  }
}

function joinParts(parts: string[]) {
  return parts
    .map((part) => part.replace(/\u0000/g, ""))
    .filter((part) => part.trim())
    .join("\n\n");
}

/** Gmail users.messages.get format=full payload. Prefers text/plain, else HTML as text. */
export function parseGmailMessageBody(payload: unknown): MailBody | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const root = (payload as { payload?: GmailPart }).payload;
  if (!root || typeof root !== "object") {
    return null;
  }
  const plain: string[] = [];
  const html: string[] = [];
  collectText(root, "text/plain", plain);
  collectText(root, "text/html", html);
  const plainText = joinParts(plain);
  if (plainText.trim()) {
    return clampPlainText(plainText);
  }
  const htmlText = joinParts(html);
  if (!htmlText.trim()) {
    return { text: "", truncated: false };
  }
  return htmlToPlainText(htmlText);
}

/** Outlook Graph message with a body property. */
export function parseOutlookMessageBody(payload: unknown): MailBody | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const body = (payload as { body?: { contentType?: string; content?: string } })
    .body;
  if (!body || typeof body.content !== "string") {
    return { text: "", truncated: false };
  }
  if ((body.contentType ?? "").toLowerCase() === "html") {
    return htmlToPlainText(body.content);
  }
  return clampPlainText(body.content);
}

export function gmailMessageBodyUrl(externalMessageId: string) {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(externalMessageId)}`,
  );
  url.searchParams.set("format", "full");
  return url.toString();
}

export function outlookMessageBodyUrl(externalMessageId: string) {
  const url = new URL(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(externalMessageId)}`,
  );
  url.searchParams.set("$select", "body");
  return url.toString();
}

import type { EmailProviderId } from "./email-providers.js";

export type EmailDraftWritePayload = {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
};

export type EmailDraftWriteResult = {
  externalDraftId: string;
};

function clampText(value: string, max: number) {
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

function parseAddressList(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    return { ok: false as const, error: `${field} must be an array of emails` };
  }
  const addresses: string[] = [];
  for (const item of value.slice(0, 20)) {
    if (typeof item !== "string" || !item.includes("@")) {
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
  if (typeof row.subject !== "string") {
    return { ok: false, error: "subject is required" };
  }
  if (typeof row.body !== "string") {
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
  return {
    ok: true,
    payload: {
      to: to.addresses,
      subject: clampText(row.subject, 500),
      body: clampText(row.body, 20_000),
      cc,
    },
  };
}

function buildRfc822(payload: EmailDraftWritePayload) {
  const headers = [
    `To: ${payload.to.join(", ")}`,
    ...(payload.cc && payload.cc.length > 0
      ? [`Cc: ${payload.cc.join(", ")}`]
      : []),
    `Subject: ${payload.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    payload.body,
  ];
  return headers.join("\r\n");
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
      subject: payload.subject,
      body: { contentType: "Text", content: payload.body },
      toRecipients: payload.to.map((address) => ({
        emailAddress: { address },
      })),
      ccRecipients: (payload.cc ?? []).map((address) => ({
        emailAddress: { address },
      })),
      isDraft: true,
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
  if (provider === "gmail") {
    if (typeof row.id !== "string" || !row.id) {
      return null;
    }
    return { externalDraftId: row.id.slice(0, 200) };
  }
  if (typeof row.id !== "string" || !row.id) {
    return null;
  }
  return { externalDraftId: row.id.slice(0, 200) };
}

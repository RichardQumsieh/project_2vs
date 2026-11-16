export type NormalizedMailMessage = {
  externalMessageId: string;
  threadId: string;
  subject: string;
  fromAddress: string;
  receivedAt: Date;
  snippet: string;
};

function clamp(value: unknown, max: number, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
) {
  if (!Array.isArray(headers)) {
    return "";
  }
  const match = headers.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  );
  return typeof match?.value === "string" ? match.value : "";
}

/** Gmail list+metadata style payloads — never require full MIME bodies. */
export function normalizeGmailMessages(payload: unknown): NormalizedMailMessage[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const messages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return [];
  }
  const out: NormalizedMailMessage[] = [];
  for (const item of messages.slice(0, 100)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) {
      continue;
    }
    const payloadObj =
      typeof row.payload === "object" && row.payload !== null
        ? (row.payload as { headers?: Array<{ name?: string; value?: string }> })
        : undefined;
    const subject = clamp(headerValue(payloadObj?.headers, "Subject"), 200, "(no subject)");
    const fromAddress = clamp(headerValue(payloadObj?.headers, "From"), 320, "(unknown)");
    const internalDate =
      typeof row.internalDate === "string" || typeof row.internalDate === "number"
        ? Number(row.internalDate)
        : NaN;
    const receivedAt = Number.isFinite(internalDate)
      ? new Date(internalDate)
      : new Date();
    out.push({
      externalMessageId: row.id.slice(0, 200),
      threadId: clamp(row.threadId, 200, row.id.slice(0, 200)),
      subject,
      fromAddress,
      receivedAt,
      snippet: clamp(row.snippet, 280),
    });
  }
  return out;
}

export function normalizeOutlookMailMessages(
  payload: unknown,
): NormalizedMailMessage[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const value = (payload as { value?: unknown }).value;
  if (!Array.isArray(value)) {
    return [];
  }
  const out: NormalizedMailMessage[] = [];
  for (const item of value.slice(0, 100)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) {
      continue;
    }
    const received =
      typeof row.receivedDateTime === "string"
        ? Date.parse(row.receivedDateTime)
        : NaN;
    const fromObj =
      typeof row.from === "object" && row.from !== null
        ? (row.from as { emailAddress?: { address?: string; name?: string } })
        : undefined;
    const fromAddress = clamp(
      fromObj?.emailAddress?.address ?? fromObj?.emailAddress?.name,
      320,
      "(unknown)",
    );
    out.push({
      externalMessageId: row.id.slice(0, 200),
      threadId: clamp(row.conversationId, 200, row.id.slice(0, 200)),
      subject: clamp(row.subject, 200, "(no subject)"),
      fromAddress,
      receivedAt: Number.isFinite(received) ? new Date(received) : new Date(),
      snippet: clamp(row.bodyPreview, 280),
    });
  }
  return out;
}

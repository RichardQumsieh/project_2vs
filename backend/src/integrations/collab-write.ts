export type SlackMessageWritePayload = {
  channelId: string;
  text: string;
};

export type SlackMessageWriteResult = {
  channelId: string;
  ts: string;
};

function clampText(value: string, max: number) {
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

export function validateSlackMessageWritePayload(body: unknown) {
  if (typeof body !== "object" || body === null) {
    return { ok: false as const, error: "Invalid payload" };
  }
  const row = body as Record<string, unknown>;
  if (typeof row.channelId !== "string" || !row.channelId.trim()) {
    return { ok: false as const, error: "channelId is required" };
  }
  if (typeof row.text !== "string" || !row.text.trim()) {
    return { ok: false as const, error: "text is required" };
  }
  // Slack channel ids are typically C…/G…/D… — keep a conservative allowlist.
  const channelId = clampText(row.channelId, 32);
  if (!/^[CGD][A-Z0-9]+$/i.test(channelId)) {
    return { ok: false as const, error: "channelId is invalid" };
  }
  return {
    ok: true as const,
    payload: {
      channelId,
      text: clampText(row.text, 4000),
    } satisfies SlackMessageWritePayload,
  };
}

export function buildSlackMessageCreateRequest(
  payload: SlackMessageWritePayload,
) {
  return {
    url: "https://slack.com/api/chat.postMessage",
    method: "POST" as const,
    body: {
      channel: payload.channelId,
      text: payload.text,
    },
  };
}

export function parseSlackMessageWriteResult(
  payload: unknown,
): SlackMessageWriteResult | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const row = payload as Record<string, unknown>;
  if (row.ok !== true) {
    return null;
  }
  if (typeof row.channel !== "string" || typeof row.ts !== "string") {
    return null;
  }
  return {
    channelId: row.channel.slice(0, 32),
    ts: row.ts.slice(0, 32),
  };
}

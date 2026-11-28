export type MobileCallAction = "accept" | "decline" | "hangup" | "mute" | "reply" | "open";

export function shouldUseFullScreenCall(appState: string): boolean {
  return appState !== "active";
}

export function parseCallAction(value: unknown): {
  action: MobileCallAction;
  callId: string;
  conversationId: string;
  reply: string | null;
} | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const action = record.action;
  if (action !== "accept" && action !== "decline" && action !== "hangup" && action !== "mute" && action !== "reply" && action !== "open") {
    return null;
  }
  return {
    action,
    callId: typeof record.callId === "string" ? record.callId : "",
    conversationId: typeof record.conversationId === "string" ? record.conversationId : "",
    reply: typeof record.reply === "string" ? record.reply : null,
  };
}

export function rememberSender(directory: Record<string, string>, id: string, name: string): Record<string, string> {
  const trimmed = name.trim();
  if (!id || !trimmed) return directory;
  return { ...directory, [id]: trimmed.slice(0, 80) };
}

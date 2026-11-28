export const MESSAGE_TITLE = "New message";
export const CALL_TITLE = "Incoming call";

export function notificationCopy(input: {
  hidePreviews: boolean;
  senderName?: string | null;
  decryptedPreview?: string | null;
  conversationOpen: boolean;
}): { show: boolean; title: string; body: string } {
  if (input.conversationOpen) return { show: false, title: MESSAGE_TITLE, body: MESSAGE_TITLE };
  const sender = input.senderName?.trim();
  if (input.hidePreviews || !sender) return { show: true, title: MESSAGE_TITLE, body: MESSAGE_TITLE };
  const preview = input.decryptedPreview?.replace(/\s+/g, " ").trim();
  return {
    show: true,
    title: sender.slice(0, 80),
    body: preview ? preview.slice(0, 140) : MESSAGE_TITLE,
  };
}

export type PushData = {
  kind?: string;
  conversationId?: string;
  senderId?: string;
  callId?: string;
  mode?: string;
  scope?: string;
};

export function readPushData(value: unknown): PushData | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = (key: string) => typeof record[key] === "string" ? record[key] : undefined;
  const kind = text("kind");
  const conversationId = text("conversationId");
  const senderId = text("senderId");
  if ((kind !== "message" && kind !== "call") || !conversationId || !senderId) return null;
  return {
    kind,
    conversationId,
    senderId,
    callId: text("callId"),
    mode: text("mode"),
    scope: text("scope"),
  };
}

export type QuickReply = { conversationId: string; text: string };

export function stageQuickReply(current: QuickReply | null, conversationId: string, text: string): QuickReply | null {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 4_000);
  if (!trimmed || !conversationId) return current;
  return { conversationId, text: trimmed };
}

export function takeQuickReply(current: QuickReply | null, conversationId: string): { next: QuickReply | null; text: string | null } {
  if (!current || current.conversationId !== conversationId) return { next: current, text: null };
  return { next: null, text: current.text };
}

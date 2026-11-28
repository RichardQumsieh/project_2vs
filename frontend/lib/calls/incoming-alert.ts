import { CALL_TITLE } from "../notifications/presentation";

export function incomingCallDecision(input: {
  direction: "incoming" | "outgoing";
  phase: "ringing" | "connecting" | "active";
  documentHidden: boolean;
  permission: "granted" | "denied" | "default" | "unsupported";
}): { notify: boolean; title: string; body: string; requireInteraction: boolean } {
  const ringing = input.direction === "incoming" && input.phase === "ringing";
  return {
    notify: ringing && input.documentHidden && input.permission === "granted",
    title: CALL_TITLE,
    body: CALL_TITLE,
    requireInteraction: true,
  };
}

export type CallNotificationAction = "accept" | "decline";

export function callActionFromMessage(value: unknown): { action: CallNotificationAction; callId: string; conversationId: string } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "sophia-call-action") return null;
  if (record.action !== "accept" && record.action !== "decline") return null;
  if (typeof record.callId !== "string" || typeof record.conversationId !== "string") return null;
  return { action: record.action, callId: record.callId, conversationId: record.conversationId };
}

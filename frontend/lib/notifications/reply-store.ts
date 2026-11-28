import { stageQuickReply, takeQuickReply, type QuickReply } from "./presentation";

let pending: QuickReply | null = null;

export function rememberQuickReply(conversationId: string, text: string) {
  pending = stageQuickReply(pending, conversationId, text);
}

export function consumeQuickReply(conversationId: string): string | null {
  const taken = takeQuickReply(pending, conversationId);
  pending = taken.next;
  return taken.text;
}

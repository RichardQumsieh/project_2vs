import {
  encodeReplyPayload,
  maxReplyRefs,
  messagePreviewText,
  parseChatPayload,
  type ReplyChatPayload,
} from "../../frontend/lib/chat-payload";
import type { LocalMessage } from "../../frontend/lib/crypto/types";

export function addReplyTarget(current: readonly string[], messageId: string, max = maxReplyRefs) {
  if (!messageId || current.includes(messageId) || current.length >= max) return [...current];
  return [...current, messageId];
}

export function removeReplyTarget(current: readonly string[], messageId: string) {
  return current.filter((id) => id !== messageId);
}

export function toggleReplyTarget(current: readonly string[], messageId: string, max = maxReplyRefs) {
  if (current.includes(messageId)) return removeReplyTarget(current, messageId);
  return addReplyTarget(current, messageId, max);
}

export function quoteRefs(
  messages: readonly Pick<LocalMessage, "id" | "logicalMessageId" | "plaintext" | "fromMe">[],
  ids: readonly string[],
): ReplyChatPayload["refs"] {
  return ids.slice(0, maxReplyRefs).flatMap((id) => {
    const message = messages.find((item) => item.id === id);
    if (!message) return [];
    const preview = messagePreviewText(message.plaintext).slice(0, 280);
    if (!preview) return [];
    return [{
      id: message.logicalMessageId ?? message.id,
      preview,
      fromMe: Boolean(message.fromMe),
    }];
  });
}

export function encodeMultiQuote(
  messages: readonly Pick<LocalMessage, "id" | "logicalMessageId" | "plaintext" | "fromMe">[],
  ids: readonly string[],
  body: string,
) {
  const refs = quoteRefs(messages, ids);
  if (!refs.length) throw new Error("Select at least one message to reply to.");
  const text = body.trim();
  if (!text) throw new Error("Write a reply before sending.");
  return encodeReplyPayload({ refs, body: text });
}

export function quotedIdsFromPlaintext(plaintext: string) {
  const payload = parseChatPayload(plaintext);
  return payload.type === "reply" ? payload.refs.map((ref) => ref.id) : [];
}

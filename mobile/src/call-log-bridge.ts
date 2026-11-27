import { api } from "./api";
import { encryptOutgoing, isUnlocked, storeSentMessage } from "../../frontend/lib/session";

type Sender = (conversationId: string, plaintext: string) => Promise<void>;

let sender: Sender | null = null;
const queued: { conversationId: string; plaintext: string }[] = [];

export function registerCallLogSender(next: Sender | null) {
  sender = next;
  return () => {
    if (sender === next) sender = null;
  };
}

export async function deliverCallLog(conversationId: string, plaintext: string) {
  if (sender) {
    await sender(conversationId, plaintext);
    return;
  }
  if (isUnlocked()) {
    try {
      const payload = await encryptOutgoing(conversationId, plaintext);
      const result = await api.sendMessage(conversationId, payload);
      await storeSentMessage({
        id: result.logicalMessageId,
        conversationId,
        plaintext,
        createdAt: result.createdAt,
      });
      return;
    } catch {
      queued.push({ conversationId, plaintext });
      return;
    }
  }
  queued.push({ conversationId, plaintext });
}

export function takeQueuedCallLogs(conversationId: string) {
  const mine = queued.filter((item) => item.conversationId === conversationId);
  for (let index = queued.length - 1; index >= 0; index -= 1) {
    if (queued[index]?.conversationId === conversationId) queued.splice(index, 1);
  }
  return mine;
}

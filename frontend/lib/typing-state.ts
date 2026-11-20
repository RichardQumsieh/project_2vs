type TypingListener = (conversationId: string, userId: string | null) => void;

const listeners = new Set<TypingListener>();
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function subscribeTyping(listener: TypingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function noteRemoteTyping(conversationId: string, userId: string): void {
  for (const listener of listeners) listener(conversationId, userId);
  const existing = clearTimers.get(conversationId);
  if (existing) clearTimeout(existing);
  clearTimers.set(
    conversationId,
    setTimeout(() => {
      clearTimers.delete(conversationId);
      for (const listener of listeners) listener(conversationId, null);
    }, 3_500),
  );
}

type ReadListener = (conversationId: string, at: string, userId: string) => void;
const readListeners = new Set<ReadListener>();

export function subscribePeerRead(listener: ReadListener): () => void {
  readListeners.add(listener);
  return () => {
    readListeners.delete(listener);
  };
}

export function notePeerRead(conversationId: string, at: string, userId: string): void {
  for (const listener of readListeners) listener(conversationId, at, userId);
}

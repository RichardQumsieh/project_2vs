/** Shared handle for the inbox realtime WebSocket (typing + read receipts). */
let activeSocket: WebSocket | null = null;

export function setRealtimeSocket(socket: WebSocket | null): void {
  activeSocket = socket;
}

export function getRealtimeSocket(): WebSocket | null {
  return activeSocket;
}

export function sendRealtimePayload(payload: Record<string, unknown>): boolean {
  const socket = activeSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

const lastTypingSent = new Map<string, number>();

/** Throttled typing ping — at most once per 2s per conversation. */
export function sendTyping(conversationId: string): boolean {
  const now = Date.now();
  const previous = lastTypingSent.get(conversationId) ?? 0;
  if (now - previous < 2_000) return false;
  lastTypingSent.set(conversationId, now);
  return sendRealtimePayload({ type: "typing", conversationId });
}

export function sendReadReceipt(conversationId: string): boolean {
  return sendRealtimePayload({
    type: "read",
    conversationId,
    at: new Date().toISOString(),
  });
}

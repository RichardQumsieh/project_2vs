type TypingEvent = { conversationId: string; userId: string };
type Listener = (event: TypingEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let lastSent = 0;

export function attachTypingSocket(next: WebSocket | null) {
  socket = next;
}

export function subscribeGroupTyping(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function noteGroupTyping(event: TypingEvent) {
  for (const listener of listeners) listener(event);
}

export function sendGroupTyping(conversationId: string) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  if (now - lastSent < 2_000) return;
  lastSent = now;
  socket.send(JSON.stringify({ type: "typing", conversationId }));
}

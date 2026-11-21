import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { getSession } from "./auth.js";
import { attachCallSignaling } from "./call-signaling.js";
import { allowedFrontendOrigins, isAllowedFrontendOrigin } from "./cors-allowlist.js";
import { env } from "./env.js";
import { redisSub } from "./redis.js";

const allowedOrigins = allowedFrontendOrigins(env.FRONTEND_ORIGIN);

type AuthenticatedSocket = {
  socket: WebSocket;
  sessionId: string;
};

const sockets = new Map<string, Set<AuthenticatedSocket>>();

function addSocket(
  userId: string,
  entry: AuthenticatedSocket,
) {
  const current = sockets.get(userId) ?? new Set();
  current.add(entry);
  sockets.set(userId, current);
}

function removeSocket(
  userId: string,
  entry: AuthenticatedSocket,
) {
  const current = sockets.get(userId);
  if (!current) return;
  current.delete(entry);
  if (current.size === 0) sockets.delete(userId);
}

export function closeSessionSockets(sessionId: string) {
  for (const connections of sockets.values()) {
    for (const entry of connections) {
      if (entry.sessionId === sessionId) {
        entry.socket.close(4401, "Session ended");
      }
    }
  }
}

export function closeUserSockets(userId: string) {
  const connections = sockets.get(userId);
  if (!connections) return;

  for (const { socket } of connections) {
    socket.close(4401, "Session ended");
  }
}

export async function registerRealtime(app: FastifyInstance) {
  void redisSub.psubscribe("user:*").catch(() => undefined);
  redisSub.on("pmessage", (_pattern: string, channel: string, message: string) => {
    const userId = channel.slice("user:".length);
    const connections = sockets.get(userId);
    if (!connections) return;
    for (const { socket } of connections) {
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  });

  app.get("/ws", { websocket: true }, async (socket, request) => {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    if (!isAllowedFrontendOrigin(origin, allowedOrigins)) {
      socket.close(4403, "Invalid origin");
      return;
    }

    const session = await getSession(request);
    if (!session) {
      socket.close(4401, "Unauthorized");
      return;
    }

    const entry = {
      socket,
      sessionId: session.sessionId,
    };
    const expiryTimer = setTimeout(() => {
      socket.close(4401, "Session expired");
    }, Math.max(0, session.expiresAt.getTime() - Date.now()));

    addSocket(session.sub, entry);
    attachCallSignaling(socket, session.sub);
    socket.send(JSON.stringify({ type: "hello", userId: session.sub }));

    socket.on("close", () => {
      clearTimeout(expiryTimer);
      removeSocket(session.sub, entry);
    });
    socket.on("error", () => {
      clearTimeout(expiryTimer);
      removeSocket(session.sub, entry);
    });
  });
}

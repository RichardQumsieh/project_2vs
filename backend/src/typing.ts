import type { WebSocket } from "@fastify/websocket";
import { prisma } from "./db.js";
import { redis } from "./redis.js";

const typingRate = new Map<string, number>();
const readRate = new Map<string, number>();

function sendError(socket: WebSocket, message: string) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "presence:error", message }));
  }
}

async function memberUserIds(conversationId: string, userId: string): Promise<string[] | null> {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { conversationId: true },
  });
  if (!member) return null;
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  return members.map((row) => row.userId);
}

export async function relayPresenceSignal(userId: string, value: unknown): Promise<void> {
  if (!value || typeof value !== "object" || !("type" in value)) {
    throw new Error("Invalid presence message.");
  }
  const type = (value as { type: unknown }).type;
  if (type !== "typing" && type !== "read") {
    throw new Error("Unsupported presence type.");
  }
  const conversationId = (value as { conversationId?: unknown }).conversationId;
  if (typeof conversationId !== "string" || conversationId.length < 8 || conversationId.length > 80) {
    throw new Error("Invalid conversation.");
  }

  const now = Date.now();
  const rateKey = `${userId}:${conversationId}:${type}`;
  const rateMap = type === "typing" ? typingRate : readRate;
  const minGap = type === "typing" ? 1_500 : 2_000;
  const previous = rateMap.get(rateKey) ?? 0;
  if (now - previous < minGap) return;
  rateMap.set(rateKey, now);
  if (rateMap.size > 20_000) {
    for (const [key, at] of rateMap) {
      if (now - at > 60_000) rateMap.delete(key);
    }
  }

  const peers = await memberUserIds(conversationId, userId);
  if (!peers) throw new Error("Conversation not found.");

  const rawAt = Reflect.get(value, "at");
  const at =
    typeof rawAt === "string" && rawAt.length > 0 && rawAt.length <= 40
      ? rawAt
      : new Date().toISOString();

  const payload =
    type === "typing"
      ? JSON.stringify({ type: "typing", conversationId, userId })
      : JSON.stringify({
          type: "read",
          conversationId,
          userId,
          at,
        });

  await Promise.all(
    peers
      .filter((peerId) => peerId !== userId)
      .map((peerId) => redis.publish(`user:${peerId}`, payload)),
  );
}

export function attachPresenceSignaling(socket: WebSocket, userId: string): void {
  let queue = Promise.resolve();
  socket.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    queue = queue
      .then(async () => {
        if (isBinary) return;
        const raw = Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Array.isArray(data)
            ? Buffer.concat(data).toString("utf8")
            : Buffer.from(data).toString("utf8");
        if (Buffer.byteLength(raw, "utf8") > 4 * 1024) {
          sendError(socket, "Presence message is too large.");
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return;
        }
        if (
          !payload ||
          typeof payload !== "object" ||
          !("type" in payload) ||
          typeof (payload as { type: unknown }).type !== "string"
        ) {
          return;
        }
        const kind = (payload as { type: string }).type;
        if (kind !== "typing" && kind !== "read") return;
        try {
          await relayPresenceSignal(userId, payload);
        } catch (error) {
          sendError(
            socket,
            error instanceof Error ? error.message : "Presence signaling failed.",
          );
        }
      })
      .catch(() => {
        sendError(socket, "Presence signaling failed.");
      });
  });
}

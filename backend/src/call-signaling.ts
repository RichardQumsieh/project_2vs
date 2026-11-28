import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { requireUser } from "./auth.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { redis } from "./redis.js";
import {
  assertGroupMediaRoute,
  createGroupCall,
  isGroupCallRecord,
  joinGroupCall,
  leaveGroupCall,
  type GroupCallRecord,
} from "./group-call.js";
import { relayGroupTyping } from "./group-typing.js";
import { callSignalSchema } from "./schemas.js";
import { isStoredInvite, readRingingInvite, type DirectCallState, type StoredCallInvite } from "./call-invite.js";
import { queueCallPush } from "./notifications-dispatch.js";
import { z } from "zod";

type CallState = {
  conversationId: string;
  callerId: string;
  calleeId: string;
  status: "ringing" | "active";
};

const ringingTtlSeconds = 45;
const activeTtlSeconds = 4 * 60 * 60;
const signalRateLimits = new Map<string, { startedAt: number; count: number; invites: number }>();

function sendCallError(socket: WebSocket, message: string) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "call:error", message }));
  }
}

function enforceSignalRateLimit(userId: string, type: string) {
  const now = Date.now();
  let rate = signalRateLimits.get(userId);
  if (!rate || now - rate.startedAt >= 60_000) {
    rate = { startedAt: now, count: 0, invites: 0 };
    signalRateLimits.set(userId, rate);
  }
  rate.count += 1;
  if (type === "call:invite" || type === "call:group-invite") rate.invites += 1;

  if (signalRateLimits.size > 10_000) {
    for (const [id, entry] of signalRateLimits) {
      if (now - entry.startedAt >= 60_000) signalRateLimits.delete(id);
    }
  }
  if (rate.count > 120 || rate.invites > 5) {
    throw new Error("Too many call requests. Please wait a moment.");
  }
}

export async function relayCallSignal(
  userId: string,
  value: unknown,
): Promise<void> {
  const parsed = callSignalSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid call signaling message.");
  }
  const signal = parsed.data;
  enforceSignalRateLimit(userId, signal.type);

  if (signal.type.startsWith("call:group-")) {
    await relayGroupCallSignal(userId, signal as GroupSignal);
    return;
  }

  if (signal.type === "call:invite") {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: signal.conversationId,
        type: "DIRECT",
        members: { some: { userId } },
      },
      select: {
        members: {
          select: {
            userId: true,
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
                avatarConfig: true,
                greetingText: true,
                greetingAnimation: true,
              },
            },
          },
        },
      },
    });
    if (!conversation || conversation.members.length !== 2) {
      throw new Error("Calls are only available in a one-to-one conversation.");
    }
    const caller = conversation.members.find((member) => member.userId === userId);
    const callee = conversation.members.find((member) => member.userId !== userId);
    if (!caller || !callee) {
      throw new Error("Conversation participants could not be verified.");
    }

    const state: CallState = {
      conversationId: signal.conversationId,
      callerId: userId,
      calleeId: callee.userId,
      status: "ringing",
    };
    const created = await redis.set(
      `call:${signal.callId}`,
      JSON.stringify(state),
      "EX",
      ringingTtlSeconds,
      "NX",
    );
    if (created !== "OK") throw new Error("This call could not be started.");

    const invite: StoredCallInvite = {
      callId: signal.callId,
      conversationId: signal.conversationId,
      senderId: userId,
      mode: signal.mode,
      scope: "direct",
      offer: signal.offer,
    };
    try {
      await redis.set(`call-invite:${signal.callId}`, JSON.stringify(invite), "EX", ringingTtlSeconds);
      await redis.publish(`user:${callee.userId}`, JSON.stringify({
        ...signal,
        senderId: userId,
        peer: caller.user,
      }));
    } catch (error) {
      await redis.del(`call:${signal.callId}`);
      await redis.del(`call-invite:${signal.callId}`);
      throw error;
    }
    void queueCallPush({
      conversationId: signal.conversationId,
      senderUserId: userId,
      recipientUserIds: [callee.userId],
      callId: signal.callId,
      mode: signal.mode,
      scope: "direct",
    });
    return;
  }

  const stateJson = await redis.get(`call:${signal.callId}`);
  if (!stateJson) throw new Error("This call has ended or expired.");
  const parsedState: unknown = JSON.parse(stateJson);
  if (isGroupCallRecord(parsedState)) {
    throw new Error("This call has ended or expired.");
  }
  const state = parsedState as CallState;
  if (
    state.conversationId !== signal.conversationId ||
    (userId !== state.callerId && userId !== state.calleeId)
  ) {
    throw new Error("You are not a participant in this call.");
  }
  const targetUserId = userId === state.callerId ? state.calleeId : state.callerId;

  if (signal.type === "call:answer") {
    if (userId !== state.calleeId || state.status !== "ringing") {
      throw new Error("This call cannot be answered.");
    }
    state.status = "active";
    await redis.set(
      `call:${signal.callId}`,
      JSON.stringify(state),
      "EX",
      activeTtlSeconds,
    );
  } else if (signal.type === "call:ice") {
    await redis.expire(
      `call:${signal.callId}`,
      state.status === "ringing" ? ringingTtlSeconds : activeTtlSeconds,
    );
  } else if (signal.type === "call:reject") {
    if (userId !== state.calleeId || state.status !== "ringing") {
      throw new Error("This call cannot be declined.");
    }
    await redis.del(`call:${signal.callId}`);
    await redis.del(`call-invite:${signal.callId}`);
  } else {
    await redis.del(`call:${signal.callId}`);
    await redis.del(`call-invite:${signal.callId}`);
  }

  await redis.publish(`user:${targetUserId}`, JSON.stringify({
    ...signal,
    senderId: userId,
  }));
}

type GroupSignal = Extract<
  ReturnType<typeof callSignalSchema.parse>,
  { type: `call:group-${string}` }
>;

async function publishCall(userId: string, payload: unknown) {
  await redis.publish(`user:${userId}`, JSON.stringify(payload));
}

async function saveGroupCall(callId: string, state: GroupCallRecord | null, ttl: number) {
  if (!state) {
    await redis.del(`call:${callId}`);
    return;
  }
  await redis.set(`call:${callId}`, JSON.stringify(state), "EX", ttl);
}

async function relayGroupCallSignal(userId: string, signal: GroupSignal) {
  if (signal.type === "call:group-invite") {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: signal.conversationId,
        type: "GROUP",
        members: { some: { userId } },
      },
      select: {
        members: {
          select: {
            userId: true,
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
                avatarConfig: true,
                greetingText: true,
                greetingAnimation: true,
              },
            },
          },
        },
      },
    });
    if (!conversation) {
      throw new Error("Group calls are only available to members of this group.");
    }
    const memberIds = conversation.members.map((member) => member.userId);
    const state = createGroupCall({
      conversationId: signal.conversationId,
      callerId: userId,
      mode: signal.mode,
      memberIds,
    });
    const created = await redis.set(
      `call:${signal.callId}`,
      JSON.stringify(state),
      "EX",
      ringingTtlSeconds,
      "NX",
    );
    if (created !== "OK") throw new Error("This call could not be started.");
    const participants = conversation.members.map((member) => member.user);
    const invite: StoredCallInvite = {
      callId: signal.callId,
      conversationId: signal.conversationId,
      senderId: userId,
      mode: signal.mode,
      scope: "group",
    };
    try {
      await redis.set(`call-invite:${signal.callId}`, JSON.stringify(invite), "EX", ringingTtlSeconds);
      await Promise.all(memberIds.filter((id) => id !== userId).map((memberId) =>
        publishCall(memberId, {
          type: "call:group-invite",
          callId: signal.callId,
          conversationId: signal.conversationId,
          mode: signal.mode,
          senderId: userId,
          joinedIds: state.joinedIds,
          participants,
        }),
      ));
    } catch (error) {
      await redis.del(`call:${signal.callId}`);
      await redis.del(`call-invite:${signal.callId}`);
      throw error;
    }
    void queueCallPush({
      conversationId: signal.conversationId,
      senderUserId: userId,
      recipientUserIds: memberIds.filter((id) => id !== userId),
      callId: signal.callId,
      mode: signal.mode,
      scope: "group",
    });
    return;
  }

  const stateJson = await redis.get(`call:${signal.callId}`);
  if (!stateJson) throw new Error("This call has ended or expired.");
  const stored: unknown = JSON.parse(stateJson);
  if (!isGroupCallRecord(stored) || stored.conversationId !== signal.conversationId) {
    throw new Error("This call has ended or expired.");
  }

  if (signal.type === "call:group-join") {
    const next = joinGroupCall(stored, userId);
    await saveGroupCall(
      signal.callId,
      next,
      next.status === "active" ? activeTtlSeconds : ringingTtlSeconds,
    );
    await Promise.all(next.participantIds.filter((id) => id !== userId).map((memberId) =>
      publishCall(memberId, {
        type: "call:group-join",
        callId: signal.callId,
        conversationId: signal.conversationId,
        senderId: userId,
        mode: next.mode,
        joinedIds: next.joinedIds,
      }),
    ));
    return;
  }

  if (signal.type === "call:group-leave") {
    const result = leaveGroupCall(stored, userId);
    await saveGroupCall(
      signal.callId,
      result.state,
      result.state?.status === "active" ? activeTtlSeconds : ringingTtlSeconds,
    );
    if (!result.state) await redis.del(`call-invite:${signal.callId}`);
    await Promise.all(result.notifyIds.map((memberId) =>
      publishCall(memberId, {
        type: "call:group-leave",
        callId: signal.callId,
        conversationId: signal.conversationId,
        senderId: userId,
        ended: result.ended,
      }),
    ));
    return;
  }

  assertGroupMediaRoute(stored, userId, signal.peerId);
  await redis.expire(
    `call:${signal.callId}`,
    stored.status === "ringing" ? ringingTtlSeconds : activeTtlSeconds,
  );
  await publishCall(signal.peerId, { ...signal, senderId: userId });
}

export async function registerCallIceServerRoute(app: FastifyInstance) {
  app.get("/calls/ice-servers", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const iceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];
    if (env.TURN_URLS && env.TURN_SHARED_SECRET) {
      const expiry = Math.floor(Date.now() / 1000) + 60 * 60;
      const username = `${expiry}:${session.sub}`;
      const credential = createHmac("sha1", env.TURN_SHARED_SECRET)
        .update(username)
        .digest("base64");
      iceServers.push({
        urls: env.TURN_URLS.split(",").map((url) => url.trim()),
        username,
        credential,
      });
    }
    return { iceServers };
  });

  app.get("/calls/:callId/invite", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { callId } = request.params as { callId: string };
    if (!z.string().uuid().safeParse(callId).success) {
      return reply.code(400).send({ error: "Invalid call." });
    }
    const [stateJson, inviteJson] = await Promise.all([
      redis.get(`call:${callId}`),
      redis.get(`call-invite:${callId}`),
    ]);
    let state: unknown = null;
    let invite: unknown = null;
    try {
      state = stateJson ? JSON.parse(stateJson) : null;
      invite = inviteJson ? JSON.parse(inviteJson) : null;
    } catch {
      return reply.code(404).send({ error: "This call has ended." });
    }
    const parsedState = isGroupCallRecord(state)
      ? state
      : state && typeof state === "object"
        ? state as DirectCallState
        : null;
    const decision = readRingingInvite({
      userId: session.sub,
      state: parsedState,
      invite: isStoredInvite(invite) ? invite : null,
    });
    if (!decision.ok) return reply.code(decision.status).send({ error: decision.error });
    return { invite: decision.invite };
  });
}

export function attachCallSignaling(
  socket: WebSocket,
  userId: string,
) {
  let queue = Promise.resolve();
  socket.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    queue = queue.then(async () => {
      if (isBinary) {
        sendCallError(socket, "Call signaling must use text messages.");
        return;
      }
      const raw = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : Buffer.from(data).toString("utf8");
      if (Buffer.byteLength(raw, "utf8") > 96 * 1024) {
        sendCallError(socket, "Call signaling message is too large.");
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("type" in payload) ||
        typeof payload.type !== "string"
      ) {
        return;
      }
      if (payload.type === "typing") {
        try {
          await relayGroupTyping(userId, payload);
        } catch {
          // Typing is best-effort presence and must not affect calls.
        }
        return;
      }
      if (!payload.type.startsWith("call:")) return;

      try {
        await relayCallSignal(userId, payload);
      } catch (error) {
        sendCallError(
          socket,
          error instanceof Error ? error.message : "Call signaling failed.",
        );
      }
    }).catch(() => {
      sendCallError(socket, "Call signaling failed.");
    });
  });
}

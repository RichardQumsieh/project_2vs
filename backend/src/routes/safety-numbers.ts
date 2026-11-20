import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { safetyNumbersEnabled } from "../env.js";
import {
  SAFETY_DEVICE_QUERY_TAKE,
  buildIdentityDirectory,
  gateSafetyNumbers,
} from "../safety-numbers.js";

/**
 * Public device identity keys for people who already share a conversation.
 * This does not consume one-time prekeys and does not return private keys.
 */
export async function safetyNumberRoutes(app: FastifyInstance) {
  app.get("/conversations/:id/identity-keys", async (request, reply) => {
    const enabled = gateSafetyNumbers(safetyNumbersEnabled);
    if (!enabled.ok) {
      return reply.code(enabled.status).send({ error: enabled.error, code: enabled.code });
    }
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const { id } = request.params as { id?: string };
    if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
      return reply.code(404).send({ error: "Conversation not found" });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        title: true,
        members: {
          select: {
            userId: true,
            role: true,
            user: { select: { username: true, displayName: true } },
          },
        },
      },
    });
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    if (!conversation.members.some((member) => member.userId === session.sub)) {
      return reply.code(404).send({ error: "Conversation not found" });
    }

    const devices = await prisma.device.findMany({
      where: {
        revokedAt: null,
        userId: { in: conversation.members.map((member) => member.userId) },
      },
      select: {
        id: true,
        userId: true,
        deviceName: true,
        identityPublicKey: true,
        signingPublicKey: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: SAFETY_DEVICE_QUERY_TAKE,
    });

    const built = buildIdentityDirectory({
      viewerUserId: session.sub,
      conversationId: conversation.id,
      type: conversation.type,
      title: conversation.title,
      members: conversation.members.map((member) => ({
        userId: member.userId,
        username: member.user.username,
        displayName: member.user.displayName,
        role: member.role,
      })),
      devices,
      queryTruncated: devices.length === SAFETY_DEVICE_QUERY_TAKE,
    });
    if (!built.ok) return reply.code(built.status).send({ error: built.error });
    return built.body;
  });
}

import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { groupE2eeEnabled } from "../env.js";
import {
  canReadGroupBlob,
  gateGroupE2ee,
  groupAccess,
  keyPackageBoundToDevice,
  planGroupMembers,
  planMembershipChange,
  validateGroupBlob,
  type GroupGateFailure,
  type GroupMlsBlobKind,
} from "../group-e2ee.js";
import {
  addGroupMemberSchema,
  createGroupSchema,
  listGroupMlsQuery,
  postGroupMlsBlobSchema,
} from "../schemas.js";
import { redis } from "../redis.js";
import { bytesToB64 } from "../util.js";
import { serializeConversation } from "./conversations.js";

/**
 * Delivery service for small MLS groups. Handlers persist opaque bytes and
 * membership metadata. They do not decrypt, log, or inspect plaintext.
 */
export async function groupRoutes(app: FastifyInstance) {
  app.post("/conversations/group", async (request, reply) => {
    const enabled = gateGroupE2ee(groupE2eeEnabled);
    if (!enabled.ok) return deny(reply, enabled);
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = createGroupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const planned = planGroupMembers(session.sub, parsed.data.memberUserIds);
    if (!planned.ok) return deny(reply, planned);

    const users = await prisma.user.findMany({
      where: { id: { in: planned.memberUserIds } },
      select: { id: true },
    });
    if (users.length !== planned.memberUserIds.length) {
      return reply.code(404).send({ error: "User not found" });
    }

    const conversation = await prisma.conversation.create({
      data: {
        type: "GROUP",
        title: parsed.data.title,
        initiatedByUserId: session.sub,
        members: { create: planned.memberUserIds.map((userId) => ({ userId })) },
      },
      include: { members: { include: { user: true } } },
    });
    return serializeConversation(conversation, session.sub);
  });

  app.post("/conversations/:id/members", async (request, reply) => {
    const enabled = gateGroupE2ee(groupE2eeEnabled);
    if (!enabled.ok) return deny(reply, enabled);
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = addGroupMemberSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    const conversation = await loadGroup(id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const access = groupAccess(conversation.members.map((member) => member.userId), session.sub);
    if (!access.ok) return deny(reply, access);
    const user = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });
    const planned = planMembershipChange(
      conversation.members.map((member) => member.userId),
      { op: "add", userId: user.id },
    );
    if (!planned.ok) return deny(reply, planned);

    await prisma.conversationMember.create({
      data: { conversationId: id, userId: user.id },
    });
    await notifyMembers(planned.memberUserIds, id);
    return { ok: true, memberUserIds: [...planned.memberUserIds].sort() };
  });

  app.delete("/conversations/:id/members/:userId", async (request, reply) => {
    const enabled = gateGroupE2ee(groupE2eeEnabled);
    if (!enabled.ok) return deny(reply, enabled);
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id, userId } = request.params as { id: string; userId: string };
    const conversation = await loadGroup(id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const access = groupAccess(conversation.members.map((member) => member.userId), session.sub);
    if (!access.ok) return deny(reply, access);
    const planned = planMembershipChange(
      conversation.members.map((member) => member.userId),
      { op: "remove", userId },
    );
    if (!planned.ok) return deny(reply, planned);

    await prisma.conversationMember.delete({
      where: { conversationId_userId: { conversationId: id, userId } },
    });
    await notifyMembers([...planned.memberUserIds, userId], id);
    return { ok: true, memberUserIds: [...planned.memberUserIds].sort() };
  });

  app.post("/conversations/:id/mls", async (request, reply) => {
    const enabled = gateGroupE2ee(groupE2eeEnabled);
    if (!enabled.ok) return deny(reply, enabled);
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = postGroupMlsBlobSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid MLS blob" });
    const blob = validateGroupBlob({ ...parsed.data, senderDeviceId: parsed.data.senderDeviceId });
    if (!blob.ok) return deny(reply, blob);

    const conversation = await loadGroup(id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const access = groupAccess(conversation.members.map((member) => member.userId), session.sub);
    if (!access.ok) return deny(reply, access);

    const device = await prisma.device.findFirst({
      where: { id: parsed.data.senderDeviceId, userId: session.sub, revokedAt: null },
      select: { id: true, signingPublicKey: true },
    });
    if (!device) return reply.code(403).send({ error: "Unknown sender device" });

    let recipientDeviceId: string | null = null;
    if (blob.recipientDeviceId) {
      const recipient = await prisma.device.findFirst({
        where: { id: blob.recipientDeviceId, revokedAt: null },
        select: { id: true, userId: true },
      });
      const memberIds = conversation.members.map((member) => member.userId);
      if (!recipient || !memberIds.includes(recipient.userId)) {
        return reply.code(400).send({ error: "Welcome recipient is not a group device" });
      }
      recipientDeviceId = recipient.id;
    }

    if (parsed.data.kind === "key_package") {
      if (
        !blob.bindingSignature ||
        !keyPackageBoundToDevice({
          signingPublicKey: device.signingPublicKey,
          payload: blob.payload,
          bindingSignature: blob.bindingSignature,
        })
      ) {
        return reply.code(400).send({ error: "Key package is not bound to the sender device" });
      }
    }

    const created = await prisma.groupMlsBlob.create({
      data: {
        conversationId: id,
        senderDeviceId: device.id,
        kind: parsed.data.kind,
        recipientDeviceId,
        payload: Buffer.from(blob.payload),
        bindingSignature: blob.bindingSignature ? Buffer.from(blob.bindingSignature) : null,
      },
    });
    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: created.createdAt },
    });
    await notifyMembers(conversation.members.map((member) => member.userId), id);
    return serializeBlob(created);
  });

  app.get("/conversations/:id/mls", async (request, reply) => {
    const enabled = gateGroupE2ee(groupE2eeEnabled);
    if (!enabled.ok) return deny(reply, enabled);
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = listGroupMlsQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });

    const conversation = await loadGroup(id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const access = groupAccess(conversation.members.map((member) => member.userId), session.sub);
    if (!access.ok) return deny(reply, access);
    const device = await prisma.device.findFirst({
      where: { id: parsed.data.deviceId, userId: session.sub, revokedAt: null },
      select: { id: true },
    });
    if (!device) return reply.code(403).send({ error: "Unknown recipient device" });

    const after = parsed.data.after
      ? await prisma.groupMlsBlob.findUnique({ where: { id: parsed.data.after } })
      : null;
    if (after && after.conversationId !== id) {
      return reply.code(400).send({ error: "Invalid MLS cursor" });
    }

    const rows = await prisma.groupMlsBlob.findMany({
      where: {
        AND: [
          { conversationId: id },
          {
            OR: [
              { kind: { not: "welcome" } },
              { recipientDeviceId: device.id },
              { senderDeviceId: device.id },
            ],
          },
          ...(after
            ? [{
                OR: [
                  { createdAt: { gt: after.createdAt } },
                  { createdAt: after.createdAt, id: { gt: after.id } },
                ],
              }]
            : []),
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: parsed.data.limit,
    });

    return {
      blobs: rows
        .filter((row) =>
          canReadGroupBlob({
            kind: row.kind as GroupMlsBlobKind,
            senderDeviceId: row.senderDeviceId,
            recipientDeviceId: row.recipientDeviceId,
            viewerDeviceId: device.id,
            viewerIsMember: true,
          }),
        )
        .map(serializeBlob),
    };
  });
}

async function loadGroup(id: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      members: { select: { userId: true } },
    },
  });
  if (!conversation || conversation.type !== "GROUP") return null;
  return conversation;
}

function serializeBlob(blob: {
  id: string;
  kind: string;
  senderDeviceId: string;
  recipientDeviceId: string | null;
  payload: Uint8Array;
  bindingSignature: Uint8Array | null;
  createdAt: Date;
}) {
  return {
    id: blob.id,
    kind: blob.kind,
    senderDeviceId: blob.senderDeviceId,
    recipientDeviceId: blob.recipientDeviceId,
    payload: bytesToB64(blob.payload),
    bindingSignature: blob.bindingSignature ? bytesToB64(blob.bindingSignature) : null,
    createdAt: blob.createdAt.toISOString(),
  };
}

function deny(reply: FastifyReply, failure: GroupGateFailure) {
  return reply.code(failure.status).send({
    error: failure.error,
    ...(failure.code ? { code: failure.code } : {}),
  });
}

async function notifyMembers(userIds: string[], conversationId: string) {
  const payload = JSON.stringify({ type: "group_mls", conversationId });
  await Promise.all(userIds.map((userId) => redis.publish(`user:${userId}`, payload)));
}

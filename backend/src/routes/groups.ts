import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { groupE2eeEnabled } from "../env.js";
import {
  admitGroupBlob,
  canReadGroupBlob,
  gateGroupE2ee,
  groupAccess,
  keyPackageBoundToDevice,
  planGroupMembers,
  planMembershipChange,
  planRoleChange,
  validateGroupBlob,
  type GroupGateFailure,
  type GroupMlsBlobKind,
} from "../group-e2ee.js";
import {
  addGroupMemberSchema,
  createGroupSchema,
  listGroupMlsQuery,
  markGroupReadSchema,
  postGroupMlsBlobSchema,
  setGroupRoleSchema,
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
    const requestedIds = [...(parsed.data.memberUserIds ?? [])];
    if (parsed.data.memberUsernames && parsed.data.memberUsernames.length > 0) {
      const named = await prisma.user.findMany({
        where: { username: { in: parsed.data.memberUsernames } },
        select: { id: true, username: true },
      });
      if (named.length !== new Set(parsed.data.memberUsernames).size) {
        return reply.code(404).send({ error: "User not found" });
      }
      requestedIds.push(...named.map((user) => user.id));
    }
    const planned = planGroupMembers(session.sub, requestedIds);
    if (!planned.ok) return deny(reply, planned);

    const users = await prisma.user.findMany({
      where: { id: { in: planned.members.map((member) => member.userId) } },
      select: { id: true },
    });
    if (users.length !== planned.members.length) {
      return reply.code(404).send({ error: "User not found" });
    }

    const conversation = await prisma.conversation.create({
      data: {
        type: "GROUP",
        title: parsed.data.title,
        initiatedByUserId: session.sub,
        members: {
          create: planned.members.map((member) => ({ userId: member.userId, role: member.role })),
        },
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
    const user = parsed.data.userId
      ? await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true } })
      : await prisma.user.findUnique({
          where: { username: parsed.data.username },
          select: { id: true },
        });
    if (!user) return reply.code(404).send({ error: "User not found" });
    const planned = planMembershipChange(
      conversation.members,
      session.sub,
      { op: "add", userId: user.id, role: parsed.data.role },
    );
    if (!planned.ok) return deny(reply, planned);

    await prisma.conversationMember.create({
      data: {
        conversationId: id,
        userId: user.id,
        role: planned.members.find((member) => member.userId === user.id)?.role ?? "MEMBER",
      },
    });
    await notifyMembers(planned.members.map((member) => member.userId), id, "welcome");
    return { ok: true, members: serializeMembers(planned.members) };
  });

  app.patch("/conversations/:id/members/:userId", async (request, reply) => {
    const enabled = gateGroupE2ee(groupE2eeEnabled);
    if (!enabled.ok) return deny(reply, enabled);
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id, userId } = request.params as { id: string; userId: string };
    const parsed = setGroupRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const conversation = await loadGroup(id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const access = groupAccess(conversation.members.map((member) => member.userId), session.sub);
    if (!access.ok) return deny(reply, access);
    const planned = planRoleChange(conversation.members, session.sub, userId, parsed.data.role);
    if (!planned.ok) return deny(reply, planned);
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId } },
      data: { role: parsed.data.role },
    });
    await notifyMembers(planned.members.map((member) => member.userId), id, "proposal");
    return { ok: true, members: serializeMembers(planned.members) };
  });

  app.post("/conversations/:id/read", async (request, reply) => {
    const enabled = gateGroupE2ee(groupE2eeEnabled);
    if (!enabled.ok) return deny(reply, enabled);
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = markGroupReadSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const conversation = await loadGroup(id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const access = groupAccess(conversation.members.map((member) => member.userId), session.sub);
    if (!access.ok) return deny(reply, access);
    const blob = parsed.data.blobId
      ? await prisma.groupMlsBlob.findFirst({
          where: { id: parsed.data.blobId, conversationId: id },
          select: { id: true },
        })
      : await prisma.groupMlsBlob.findFirst({
          where: { conversationId: id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
    if (parsed.data.blobId && !blob) return reply.code(400).send({ error: "Invalid read cursor" });
    if (blob) {
      await prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId: id, userId: session.sub } },
        data: { groupReadBlobId: blob.id },
      });
    }
    return { ok: true, blobId: blob?.id ?? null };
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
      conversation.members,
      session.sub,
      { op: "remove", userId },
    );
    if (!planned.ok) return deny(reply, planned);

    await prisma.conversationMember.delete({
      where: { conversationId_userId: { conversationId: id, userId } },
    });
    await notifyMembers([...planned.members.map((member) => member.userId), userId], id, "commit");
    return { ok: true, members: serializeMembers(planned.members) };
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

    if (parsed.data.clientId) {
      const existing = await prisma.groupMlsBlob.findUnique({
        where: {
          conversationId_clientId: { conversationId: id, clientId: parsed.data.clientId },
        },
      });
      if (existing) {
        const samePayload = Buffer.from(existing.payload).equals(Buffer.from(blob.payload));
        if (existing.senderDeviceId !== device.id || !samePayload || existing.kind !== parsed.data.kind) {
          return reply.code(409).send({ error: "MLS client id was already used" });
        }
        return serializeBlob(existing);
      }
    }

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ mlsEpoch: number; type: string }>>`
          SELECT "mlsEpoch", "type"::text AS "type" FROM "Conversation" WHERE "id" = ${id} FOR UPDATE
        `;
        const current = locked[0];
        if (!current || current.type !== "GROUP") {
          throw new DeliveryReject({ ok: false, status: 404, error: "Conversation not found" });
        }
        const recorded = await tx.groupMlsCommit.findUnique({
          where: { conversationId_epoch: { conversationId: id, epoch: current.mlsEpoch } },
          select: { epoch: true },
        });
        const admitted = admitGroupBlob({
          ...parsed.data,
          senderDeviceId: device.id,
          conversationId: id,
          currentEpoch: current.mlsEpoch,
          commitRecordedForCurrentEpoch: recorded !== null,
        });
        if (!admitted.ok) throw new DeliveryReject(admitted);
        const row = await tx.groupMlsBlob.create({
          data: {
            conversationId: id,
            senderDeviceId: device.id,
            clientId: parsed.data.clientId,
            kind: parsed.data.kind,
            recipientDeviceId,
            payload: Buffer.from(admitted.payload),
            bindingSignature: admitted.bindingSignature ? Buffer.from(admitted.bindingSignature) : null,
            epoch: admitted.epoch,
          },
        });
        if (admitted.recordCommit && admitted.epoch !== null) {
          await tx.groupMlsCommit.create({
            data: { conversationId: id, epoch: admitted.epoch, blobId: row.id },
          });
        }
        await tx.conversation.update({
          where: { id },
          data: {
            ...(admitted.recordCommit ? { mlsEpoch: admitted.nextEpoch } : {}),
            updatedAt: row.createdAt,
          },
        });
        return row;
      });
    } catch (error) {
      if (error instanceof DeliveryReject) return deny(reply, error.failure);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = uniqueTarget(error);
        if (parsed.data.clientId && target.includes("clientId")) {
          const existing = await prisma.groupMlsBlob.findUnique({
            where: {
              conversationId_clientId: { conversationId: id, clientId: parsed.data.clientId },
            },
          });
          if (existing) return serializeBlob(existing);
        }
        return reply.code(409).send({
          error: "Another member already committed this epoch",
          code: "mls_epoch_conflict",
        });
      }
      throw error;
    }
    await notifyMembers(conversation.members.map((member) => member.userId), id, parsed.data.kind);
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

  app.get("/conversations/:id/group-devices", async (request, reply) => {
    const enabled = gateGroupE2ee(groupE2eeEnabled);
    if (!enabled.ok) return deny(reply, enabled);
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const conversation = await loadGroup(id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const access = groupAccess(conversation.members.map((member) => member.userId), session.sub);
    if (!access.ok) return deny(reply, access);
    const roleByUser = new Map(conversation.members.map((member) => [member.userId, member.role]));
    const devices = await prisma.device.findMany({
      where: {
        userId: { in: conversation.members.map((member) => member.userId) },
        revokedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        signingPublicKey: true,
        user: { select: { username: true, displayName: true } },
      },
    });
    const perUser = new Map<string, number>();
    const visible = devices.filter((device) => {
      const count = perUser.get(device.userId) ?? 0;
      if (count >= 2) return false;
      perUser.set(device.userId, count + 1);
      return true;
    });
    return {
      devices: visible.map((device) => ({
        userId: device.userId,
        deviceId: device.id,
        signingPublicKey: bytesToB64(device.signingPublicKey),
        role: roleByUser.get(device.userId) === "ADMIN" ? "admin" : "member",
        username: device.user.username,
        displayName: device.user.displayName,
      })),
    };
  });
}

async function loadGroup(id: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      mlsEpoch: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!conversation || conversation.type !== "GROUP") return null;
  return conversation;
}

class DeliveryReject extends Error {
  constructor(readonly failure: GroupGateFailure) {
    super(failure.error);
    this.name = "DeliveryReject";
  }
}

function uniqueTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.join(",");
  return typeof target === "string" ? target : "";
}

function serializeBlob(blob: {
  id: string;
  kind: string;
  senderDeviceId: string;
  recipientDeviceId: string | null;
  payload: Uint8Array;
  bindingSignature: Uint8Array | null;
  clientId?: string | null;
  createdAt: Date;
}) {
  return {
    id: blob.id,
    clientId: blob.clientId ?? null,
    kind: blob.kind,
    senderDeviceId: blob.senderDeviceId,
    recipientDeviceId: blob.recipientDeviceId,
    payload: bytesToB64(blob.payload),
    bindingSignature: blob.bindingSignature ? bytesToB64(blob.bindingSignature) : null,
    createdAt: blob.createdAt.toISOString(),
  };
}

function serializeMembers(members: readonly { userId: string; role: "ADMIN" | "MEMBER" }[]) {
  return [...members]
    .map((member) => ({ userId: member.userId, role: member.role }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
}

function deny(reply: FastifyReply, failure: GroupGateFailure) {
  return reply.code(failure.status).send({
    error: failure.error,
    ...(failure.code ? { code: failure.code } : {}),
  });
}

async function notifyMembers(userIds: string[], conversationId: string, kind?: GroupMlsBlobKind) {
  const payload = JSON.stringify({
    type: "group_mls",
    conversationId,
    ...(kind ? { kind } : {}),
  });
  await Promise.all(userIds.map((userId) => redis.publish(`user:${userId}`, payload)));
}

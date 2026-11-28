import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import {
  createDirectSchema,
  deleteMessageSchema,
  listAccountArchiveMessagesQuery,
  listMessageDeletionsQuery,
  listMessagesQuery,
  recipientDevicesQuery,
  saveAccountArchiveMessagesSchema,
  sendMessageSchema,
} from "../schemas.js";
import { b64ToBytes, bytesToB64, directKeyFor, publicUser } from "../util.js";
import { redis } from "../redis.js";
import { canListConversation } from "../conversation-visibility.js";
import { readCursorsFor, unreadCountsFor } from "../group-read.js";
import {
  canDeleteMessages,
  messageDeletionRecordIds,
} from "../message-deletion.js";

export async function conversationRoutes(app: FastifyInstance) {
  app.post("/conversations/direct", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = createDirectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input" });
    }

    const peer = await prisma.user.findUnique({
      where: { username: parsed.data.username.toLowerCase() },
    });
    if (!peer) return reply.code(404).send({ error: "User not found" });
    if (peer.id === session.sub) {
      return reply.code(400).send({ error: "You cannot message yourself" });
    }

    const key = directKeyFor(session.sub, peer.id);
    const conversation = await prisma.conversation.upsert({
      where: { directKey: key },
      create: {
        type: "DIRECT",
        directKey: key,
        initiatedByUserId: session.sub,
        members: {
          create: [{ userId: session.sub }, { userId: peer.id }],
        },
      },
      update: {},
      include: {
        members: { include: { user: true } },
      },
    });

    if (!conversation.initiatedByUserId) {
      await prisma.conversation.updateMany({
        where: {
          id: conversation.id,
          initiatedByUserId: null,
          messages: { none: {} },
        },
        data: { initiatedByUserId: session.sub },
      });
    }

    return serializeConversation(conversation, session.sub);
  });

  app.get("/conversations", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const conversations = await prisma.conversation.findMany({
      where: { members: { some: { userId: session.sub } } },
      include: {
        members: { include: { user: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });

    const visible = conversations.filter((conversation: any) =>
      canListConversation({
        type: conversation.type,
        initiatedByUserId: conversation.initiatedByUserId,
        hasMessages: conversation.messages.length > 0,
        userId: session.sub,
      }),
    );
    const groupIds = visible
      .filter((conversation: { type: string }) => conversation.type === "GROUP")
      .map((conversation: { id: string }) => conversation.id);
    const unread = await unreadCountsFor(session.sub, groupIds);
    const readCursors = await readCursorsFor(groupIds);
    return {
      conversations: visible.map((conversation: any) =>
        serializeConversation(
          conversation,
          session.sub,
          unread.get(conversation.id) ?? 0,
          readCursors.get(conversation.id),
        ),
      ),
    };
  });

  app.get("/conversations/:id/messages", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const parsed = listMessagesQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });

    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: session.sub } },
    });
    if (!member) return reply.code(404).send({ error: "Conversation not found" });

    const listed = await prisma.conversation.findUnique({
      where: { id },
      select: { type: true },
    });
    if (listed?.type === "GROUP") {
      return reply.code(409).send({
        error: "Group conversations accept MLS blobs, not pairwise envelopes.",
      });
    }

    if (parsed.data.deviceId) {
      const device = await prisma.device.findFirst({
        where: {
          id: parsed.data.deviceId,
          userId: session.sub,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!device) return reply.code(403).send({ error: "Unknown recipient device" });
    }

    const after = parsed.data.after
      ? await prisma.message.findUnique({ where: { id: parsed.data.after } })
      : null;
    if (after && after.conversationId !== id) {
      return reply.code(400).send({ error: "Invalid message cursor" });
    }

    const messages = await prisma.message.findMany({
      where: {
        conversationId: id,
        ...(after
          ? {
              OR: [
                { createdAt: { gt: after.createdAt } },
                {
                  createdAt: after.createdAt,
                  id: { gt: after.id },
                },
              ],
            }
          : {}),
        ...(parsed.data.before
          ? {
              OR: [
                { createdAt: { lt: new Date(parsed.data.before) } },
                {
                  createdAt: new Date(parsed.data.before),
                  id: { lt: parsed.data.beforeId! },
                },
              ],
            }
          : {}),
        ...(parsed.data.deviceId
          ? {
              AND: [{
                OR: [
                  { recipientDeviceId: parsed.data.deviceId },
                  {
                    recipientDeviceId: null,
                    senderDevice: { userId: { not: session.sub } },
                  },
                ],
              }],
            }
          : {}),
      },
      include: { senderDevice: true },
      orderBy: after
        ? [{ createdAt: "asc" }, { id: "asc" }]
        : parsed.data.fromStart
          ? [{ createdAt: "asc" }, { id: "asc" }]
          : [{ createdAt: "desc" }, { id: "desc" }],
      take: parsed.data.limit,
    });

    const ordered = after || parsed.data.fromStart ? messages : messages.reverse();
    return { messages: ordered.map(serializeMessage) };
  });

  app.get("/conversations/:id/message-deletions", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const { id } = request.params as { id: string };
    const parsed = listMessageDeletionsQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid deletion cursor." });
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: session.sub } },
      select: { conversationId: true },
    });
    if (!member) return reply.code(404).send({ error: "Conversation not found." });

    const cursor = parsed.data.after
      ? await prisma.messageDeletion.findUnique({
          where: {
            conversationId_logicalMessageId: {
              conversationId: id,
              logicalMessageId: parsed.data.after,
            },
          },
        })
      : null;
    if (parsed.data.after && !cursor) {
      return reply.code(400).send({ error: "Invalid deletion cursor." });
    }

    const deletions = await prisma.messageDeletion.findMany({
      where: {
        conversationId: id,
        ...(cursor
          ? {
              OR: [
                { deletedAt: { gt: cursor.deletedAt } },
                {
                  deletedAt: cursor.deletedAt,
                  logicalMessageId: { gt: cursor.logicalMessageId },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ deletedAt: "asc" }, { logicalMessageId: "asc" }],
      take: parsed.data.limit,
      select: { logicalMessageId: true, messageRecordIds: true, deletedAt: true },
    });
    return {
      deletions: deletions.map((deletion: {
        logicalMessageId: string;
        messageRecordIds: string[];
        deletedAt: Date;
      }) => ({
        logicalMessageId: deletion.logicalMessageId,
        messageRecordIds: deletion.messageRecordIds,
        deletedAt: deletion.deletedAt.toISOString(),
      })),
    };
  });

  app.delete("/conversations/:id/messages/:logicalMessageId", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { id, logicalMessageId } = request.params as {
      id: string;
      logicalMessageId: string;
    };
    const parsed = deleteMessageSchema.safeParse({ logicalMessageId });
    if (!parsed.success) return reply.code(400).send({ error: "Invalid message ID." });

    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: session.sub } },
      select: { conversationId: true },
    });
    if (!member) return reply.code(404).send({ error: "Conversation not found." });

    const existingDeletion = await prisma.messageDeletion.findUnique({
      where: {
        conversationId_logicalMessageId: {
          conversationId: id,
          logicalMessageId: parsed.data.logicalMessageId,
        },
      },
    });
    if (existingDeletion) {
      if (existingDeletion.deletedByUserId !== session.sub) {
        return reply.code(404).send({ error: "Message not found." });
      }
      return { ok: true, logicalMessageId: parsed.data.logicalMessageId };
    }

    const messages = await prisma.message.findMany({
      where: {
        conversationId: id,
        OR: [
          { logicalMessageId: parsed.data.logicalMessageId },
          { id: parsed.data.logicalMessageId },
        ],
      },
      select: {
        id: true,
        logicalMessageId: true,
        senderDevice: { select: { userId: true } },
      },
    });
    const deletableMessages = messages.map((message: {
      id: string;
      logicalMessageId: string | null;
      senderDevice: { userId: string };
    }) => ({
      id: message.id,
      logicalMessageId: message.logicalMessageId,
      senderUserId: message.senderDevice.userId,
    }));
    if (!canDeleteMessages(deletableMessages, session.sub)) {
      return reply.code(404).send({ error: "Message not found." });
    }

    const messageRecordIds = messageDeletionRecordIds(
      parsed.data.logicalMessageId,
      deletableMessages,
    );
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: id },
      select: { userId: true },
    });
    const deletion = await prisma.$transaction(async (tx: any) => {
      const tombstone = await tx.messageDeletion.upsert({
        where: {
          conversationId_logicalMessageId: {
            conversationId: id,
            logicalMessageId: parsed.data.logicalMessageId,
          },
        },
        create: {
          conversationId: id,
          logicalMessageId: parsed.data.logicalMessageId,
          deletedByUserId: session.sub,
          messageRecordIds,
        },
        update: {},
      });
      await tx.message.deleteMany({
        where: { conversationId: id, id: { in: deletableMessages.map((message) => message.id) } },
      });
      await tx.accountArchiveMessage.deleteMany({
        where: {
          conversationId: id,
          logicalMessageId: parsed.data.logicalMessageId,
        },
      });
      await tx.deviceBackup.deleteMany({
        where: { kind: "message", recordId: { in: messageRecordIds } },
      });
      return tombstone;
    });

    await Promise.all(members.map((conversationMember: { userId: string }) =>
      redis.publish(
        `user:${conversationMember.userId}`,
        JSON.stringify({
          type: "message_deleted",
          conversationId: id,
          logicalMessageId: parsed.data.logicalMessageId,
          messageRecordIds,
          deletedAt: deletion.deletedAt.toISOString(),
        }),
      ),
    ));
    return { ok: true, logicalMessageId: parsed.data.logicalMessageId };
  });

  app.get("/conversations/:id/recipient-devices", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const parsed = recipientDevicesQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid sender device" });
    }

    const senderDevice = await prisma.device.findFirst({
      where: {
        id: parsed.data.senderDeviceId,
        userId: session.sub,
        revokedAt: null,
      },
      select: { id: true },
    });

    if (!senderDevice) {
      return reply.code(403).send({ error: "Unknown sender device" });
    }

    const members = await prisma.conversationMember.findMany({
      where: {
        conversationId: id,
        userId: session.sub,
      },
      select: { conversationId: true },
    });
    if (members.length === 0) {
      return reply.code(404).send({ error: "Conversation not found" });
    }

    const devices = await prisma.device.findMany({
      where: {
        revokedAt: null,
        user: {
          memberships: {
            some: { conversationId: id },
          },
        },
        id: { not: senderDevice.id },
      },
      select: {
        id: true,
        user: { select: { username: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    return {
      devices: devices.map((device: { id: string; user: { username: string } }) => ({
        deviceId: device.id,
        username: device.user.username,
      })),
    };
  });

  app.get("/conversations/:id/archive-keys", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const { id } = request.params as { id: string };
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: id },
      select: { userId: true },
    });
    if (!members.some((member: { userId: string }) => member.userId === session.sub)) {
      return reply.code(404).send({ error: "Conversation not found." });
    }

    const keys = await prisma.accountArchiveKey.findMany({
      where: { userId: { in: members.map((member: { userId: string }) => member.userId) } },
      select: { userId: true, publicKey: true },
    });
    if (keys.length !== members.length) {
      return reply.code(409).send({
        error: "Every conversation member must sign in once to enable encrypted cross-device history.",
      });
    }
    return {
      keys: keys.map((key: { userId: string; publicKey: Uint8Array }) => ({
        userId: key.userId,
        publicKey: bytesToB64(key.publicKey),
      })),
    };
  });

  app.get("/conversations/:id/archive-messages", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const { id } = request.params as { id: string };
    const parsed = listAccountArchiveMessagesQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid archive query." });
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: session.sub } },
      select: { userId: true },
    });
    if (!member) return reply.code(404).send({ error: "Conversation not found." });

    const after = parsed.data.after
      ? await prisma.accountArchiveMessage.findUnique({
          where: {
            ownerUserId_logicalMessageId: {
              ownerUserId: session.sub,
              logicalMessageId: parsed.data.after,
            },
          },
        })
      : null;
    if (after && after.conversationId !== id) {
      return reply.code(400).send({ error: "Invalid archive cursor." });
    }

    const records = await prisma.accountArchiveMessage.findMany({
      where: {
        ownerUserId: session.sub,
        conversationId: id,
        ...(after
          ? {
              OR: [
                { createdAt: { gt: after.createdAt } },
                {
                  createdAt: after.createdAt,
                  logicalMessageId: { gt: after.logicalMessageId },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { logicalMessageId: "asc" }],
      take: parsed.data.limit,
    });
    return {
      records: records.map((record: any) => ({
        logicalMessageId: record.logicalMessageId,
        conversationId: record.conversationId,
        senderUserId: record.senderUserId,
        senderDeviceId: record.senderDeviceId,
        ephemeralPublicKey: bytesToB64(record.ephemeralPublicKey),
        nonce: bytesToB64(record.nonce),
        ciphertext: bytesToB64(record.ciphertext),
        createdAt: record.createdAt.toISOString(),
      })),
    };
  });

  app.post("/conversations/:id/messages", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid message" });
    const archiveEnvelopes =
      "archiveEnvelopes" in parsed.data ? parsed.data.archiveEnvelopes ?? null : null;

    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: session.sub } },
    });
    if (!member) return reply.code(404).send({ error: "Conversation not found" });

    const target = await prisma.conversation.findUnique({
      where: { id },
      select: { type: true },
    });
    if (target?.type === "GROUP") {
      return reply.code(409).send({
        error: "Group conversations accept MLS blobs, not pairwise envelopes.",
      });
    }

    const device = await prisma.device.findFirst({
      where: {
        id: parsed.data.senderDeviceId,
        userId: session.sub,
        revokedAt: null,
      },
    });
    if (!device) return reply.code(403).send({ error: "Unknown sender device" });

    // A mobile sender keeps the exact encrypted payload in its local outbox until
    // the server acknowledges it. If the response is lost, retrying the same
    // logical ID returns the first write instead of creating duplicate messages.
    const logicalMessageId =
      "logicalMessageId" in parsed.data
        ? parsed.data.logicalMessageId ?? randomUUID()
        : randomUUID();
    const existing = await prisma.message.findMany({
      where: { conversationId: id, logicalMessageId },
      include: {
        senderDevice: true,
        recipientDevice: { select: { userId: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (existing.length > 0) {
      if (existing.some((message: any) => message.senderDeviceId !== device.id)) {
        return reply.code(409).send({ error: "Message ID is already in use." });
      }
      const wasDeleted = await prisma.messageDeletion.findUnique({
        where: { conversationId_logicalMessageId: { conversationId: id, logicalMessageId } },
        select: { logicalMessageId: true },
      });
      if (wasDeleted) return reply.code(409).send({ error: "This message has already been deleted." });
      return {
        logicalMessageId,
        createdAt: existing[0]!.createdAt.toISOString(),
        message: serializeMessage(existing[0]!),
        messages: existing.map(serializeMessage),
      };
    }

    let envelopes: {
      recipientDeviceId?: string;
      ciphertext: string;
      nonce: string;
      ratchetHeader: unknown;
    }[];
    if ("envelopes" in parsed.data) {
      envelopes = parsed.data.envelopes;
    } else {
      envelopes = [parsed.data];
    }

    if (archiveEnvelopes) {
      const members = await prisma.conversationMember.findMany({
        where: { conversationId: id },
        select: { userId: true },
      });
      const archiveKeys = await prisma.accountArchiveKey.findMany({
        where: { userId: { in: members.map((item: { userId: string }) => item.userId) } },
        select: { userId: true, publicKey: true },
      });
      const archiveKeyByUser = new Map(
        archiveKeys.map((key: { userId: string; publicKey: Uint8Array }) => [
          key.userId,
          bytesToB64(key.publicKey),
        ]),
      );
      const providedArchiveUsers = new Set(
        archiveEnvelopes.map((envelope) => envelope.ownerUserId),
      );
      if (
        archiveKeyByUser.size !== members.length ||
        providedArchiveUsers.size !== members.length ||
        members.some((item: { userId: string }) =>
          !providedArchiveUsers.has(item.userId) ||
          archiveKeyByUser.get(item.userId) !==
            archiveEnvelopes.find((envelope) => envelope.ownerUserId === item.userId)
              ?.recipientPublicKey,
        )
      ) {
        return reply.code(409).send({
          error: "Account archive keys changed or are unavailable. Refresh and retry sending.",
        });
      }
    }

    if ("envelopes" in parsed.data) {
      const expectedDevices = await prisma.device.findMany({
        where: {
          revokedAt: null,
          user: {
            memberships: {
              some: { conversationId: id },
            },
          },
          id: { not: device.id },
        },
        select: {
          id: true,
          userId: true,
        },
      });
      const peerMembers = await prisma.conversationMember.findMany({
        where: {
          conversationId: id,
          userId: { not: session.sub },
        },
        select: { userId: true },
      });
      const activePeerUsers = new Set(
        expectedDevices
          .filter((target: { userId: string }) => target.userId !== session.sub)
          .map((target: { userId: string }) => target.userId),
      );
      if (peerMembers.some((peer: { userId: string }) => !activePeerUsers.has(peer.userId))) {
        return reply.code(409).send({
          error: "Every other conversation member needs an active messaging device.",
        });
      }

      const expectedIds = new Set(
        expectedDevices.map((target: { id: string }) => target.id),
      );
      const providedIds = new Set(
        envelopes.map((envelope) => envelope.recipientDeviceId),
      );
      if (
        expectedIds.size !== providedIds.size ||
        [...expectedIds].some((targetId) => !providedIds.has(targetId))
      ) {
        return reply.code(409).send({
          error: "The active device list changed. Refresh and retry sending.",
        });
      }

      for (const envelope of envelopes) {
        if (
          headerRecipientDeviceId(envelope.ratchetHeader) !==
          envelope.recipientDeviceId
        ) {
          return reply.code(400).send({
            error: "Envelope recipient does not match its encrypted header",
          });
        }
      }
    }

    const createdAt = new Date();
    const messages = await prisma.$transaction(async (tx: any) => {
      const deletedMessage = await tx.messageDeletion.findUnique({
        where: {
          conversationId_logicalMessageId: {
            conversationId: id,
            logicalMessageId,
          },
        },
        select: { logicalMessageId: true },
      });
      if (deletedMessage) return null;

      const created = await Promise.all(
        envelopes.map((envelope) =>
          tx.message.create({
              data: {
                logicalMessageId,
                conversationId: id,
                senderDeviceId: parsed.data.senderDeviceId,
                recipientDeviceId: envelope.recipientDeviceId,
                ciphertext: b64ToBytes(envelope.ciphertext),
                nonce: b64ToBytes(envelope.nonce),
                ratchetHeader: envelope.ratchetHeader,
                createdAt,
              },
              include: {
                senderDevice: true,
                recipientDevice: { select: { userId: true } },
              },
            }),
        ),
      );
      if (archiveEnvelopes) {
        await tx.accountArchiveMessage.createMany({
          data: archiveEnvelopes.map((envelope) => ({
            ownerUserId: envelope.ownerUserId,
            logicalMessageId,
            conversationId: id,
            senderUserId: session.sub,
            senderDeviceId: device.id,
            ephemeralPublicKey: b64ToBytes(envelope.ephemeralPublicKey),
            nonce: b64ToBytes(envelope.nonce),
            ciphertext: b64ToBytes(envelope.ciphertext),
            createdAt,
          })),
        });
      }
      await tx.conversation.update({
        where: { id },
        data: { updatedAt: createdAt },
      });
      await tx.device.update({
        where: { id: device.id },
        data: { lastSeenAt: createdAt },
      });
      return created;
    });
    if (!messages) {
      return reply.code(409).send({ error: "This message has already been deleted." });
    }

    const legacyMembers = messages.some(
      (message: any) => message.recipientDeviceId === null,
    )
      ? await prisma.conversationMember.findMany({
          where: { conversationId: id },
          select: { userId: true },
        })
      : [];
    const publications = messages.flatMap((message: any) => {
      const payload = JSON.stringify({
        type: "message",
        conversationId: id,
        message: serializeMessage(message),
      });
      const userIds = message.recipientDevice
        ? new Set([
            message.senderDevice.userId,
            message.recipientDevice.userId,
          ])
        : new Set(legacyMembers.map((item: { userId: string }) => item.userId));
      return [...userIds].map((userId) =>
        redis.publish(`user:${userId}`, payload),
      );
    });
    await Promise.all(publications);

    return {
      logicalMessageId,
      createdAt: createdAt.toISOString(),
      message: serializeMessage(messages[0]!),
      messages: messages.map(serializeMessage),
    };
  });
}

function headerRecipientDeviceId(header: unknown): string | undefined {
  if (
    typeof header !== "object" ||
    header === null ||
    !("recipientDeviceId" in header)
  ) {
    return undefined;
  }
  const recipientDeviceId = (header as { recipientDeviceId?: unknown }).recipientDeviceId;
  return typeof recipientDeviceId === "string" ? recipientDeviceId : undefined;
}

function serializeMessage(message: {
  id: string;
  logicalMessageId: string | null;
  conversationId: string;
  senderDeviceId: string;
  recipientDeviceId: string | null;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  ratchetHeader: unknown;
  createdAt: Date;
  senderDevice: { identityPublicKey: Uint8Array; userId: string };
}) {
  return {
    id: message.id,
    logicalMessageId: message.logicalMessageId ?? message.id,
    conversationId: message.conversationId,
    senderDeviceId: message.senderDeviceId,
    senderUserId: message.senderDevice.userId,
    recipientDeviceId: message.recipientDeviceId ?? undefined,
    senderIdentityPublicKey: bytesToB64(message.senderDevice.identityPublicKey),
    ciphertext: bytesToB64(message.ciphertext),
    nonce: bytesToB64(message.nonce),
    ratchetHeader: message.ratchetHeader,
    createdAt: message.createdAt.toISOString(),
  };
}

export function serializeConversation(
  conversation: {
    id: string;
    type: "DIRECT" | "GROUP";
    title?: string | null;
    createdAt?: Date;
    updatedAt: Date;
    members: {
      userId: string;
      role?: "ADMIN" | "MEMBER";
      groupReadBlobId?: string | null;
      user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
    }[];
    messages?: { createdAt: Date }[];
  },
  userId: string,
  unreadCount = 0,
  readCursors?: ReadonlyMap<string, { blobId: string; createdAt: string }>,
) {
  const peer = conversation.members.find((member) => member.userId !== userId)?.user;
  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title ?? null,
    ...(conversation.createdAt ? { createdAt: conversation.createdAt.toISOString() } : {}),
    memberUserIds: conversation.members.map((member) => member.userId).sort(),
    members: conversation.members
      .map((member) => ({
        userId: member.userId,
        username: member.user.username,
        displayName: member.user.displayName,
        avatarUrl: member.user.avatarUrl,
        role: member.role ?? "MEMBER",
        ...(conversation.type === "GROUP"
          ? { readCursor: readCursors?.get(member.userId) ?? null }
          : {}),
      }))
      .sort((left, right) => left.username.localeCompare(right.username)),
    updatedAt: conversation.updatedAt.toISOString(),
    peer: peer ? publicUser(peer) : null,
    lastMessageAt: conversation.messages?.[0]?.createdAt.toISOString() ?? null,
    unreadCount: conversation.type === "GROUP" ? unreadCount : 0,
  };
}

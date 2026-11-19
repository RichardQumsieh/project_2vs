import type { FastifyInstance } from "fastify";
import { archiveRecoveryHashMatches } from "../archive-recovery.js";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import {
  createAccountArchiveKeySchema,
  prekeyBundleQuery,
  rewrapAccountArchiveKeySchema,
  registerDeviceSchema,
  deviceVaultBackupSchema,
  listDeviceBackupsQuery,
  saveDeviceBackupsSchema,
  saveAccountArchiveMessagesSchema,
  replenishPreKeysSchema,
} from "../schemas.js";
import { b64ToBytes, bytesToB64, publicUser } from "../util.js";

export async function deviceRoutes(app: FastifyInstance) {
  app.get("/account-archive/key", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const key = await prisma.accountArchiveKey.findUnique({
      where: { userId: session.sub },
      select: {
        publicKey: true,
        passwordSalt: true,
        passwordNonce: true,
        passwordEncryptedPrivateKey: true,
        recoverySalt: true,
        recoveryNonce: true,
        recoveryEncryptedPrivateKey: true,
      },
    });
    if (!key) return { key: null };
    return {
      key: {
        publicKey: bytesToB64(key.publicKey),
        passwordSalt: bytesToB64(key.passwordSalt),
        passwordNonce: bytesToB64(key.passwordNonce),
        passwordEncryptedPrivateKey: bytesToB64(key.passwordEncryptedPrivateKey),
        recoverySalt: bytesToB64(key.recoverySalt),
        recoveryNonce: bytesToB64(key.recoveryNonce),
        recoveryEncryptedPrivateKey: bytesToB64(key.recoveryEncryptedPrivateKey),
      },
    };
  });

  app.put("/account-archive/key", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const parsed = createAccountArchiveKeySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid account archive key." });
    const key = parsed.data.key;
    try {
      await prisma.accountArchiveKey.create({
        data: {
          userId: session.sub,
          publicKey: b64ToBytes(key.publicKey),
          passwordSalt: b64ToBytes(key.passwordSalt),
          passwordNonce: b64ToBytes(key.passwordNonce),
          passwordEncryptedPrivateKey: b64ToBytes(key.passwordEncryptedPrivateKey),
          recoverySalt: b64ToBytes(key.recoverySalt),
          recoveryNonce: b64ToBytes(key.recoveryNonce),
          recoveryEncryptedPrivateKey: b64ToBytes(key.recoveryEncryptedPrivateKey),
          recoveryCodeHash: key.recoveryCodeHash,
        },
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return reply.code(409).send({ error: "The account archive key already exists." });
      }
      throw error;
    }
    return { ok: true };
  });

  app.put("/account-archive/key/password-wrap", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const parsed = rewrapAccountArchiveKeySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid account archive recovery." });
    const existing = await prisma.accountArchiveKey.findUnique({
      where: { userId: session.sub },
      select: { recoveryCodeHash: true },
    });
    if (!existing) return reply.code(404).send({ error: "Account archive key not found." });

    if (!archiveRecoveryHashMatches(existing.recoveryCodeHash, parsed.data.recoveryCodeHash)) {
      return reply.code(403).send({ error: "Invalid account history recovery code." });
    }

    await prisma.accountArchiveKey.update({
      where: { userId: session.sub },
      data: {
        passwordSalt: b64ToBytes(parsed.data.passwordSalt),
        passwordNonce: b64ToBytes(parsed.data.passwordNonce),
        passwordEncryptedPrivateKey: b64ToBytes(parsed.data.passwordEncryptedPrivateKey),
      },
    });
    return { ok: true };
  });

  app.post("/account-archive/messages", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const parsed = saveAccountArchiveMessagesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid account archive records." });

    const conversationIds = [...new Set(parsed.data.records.map((record) => record.conversationId))];
    const senderUserIds = [...new Set(parsed.data.records.map((record) => record.senderUserId))];
    const senderDeviceIds = [...new Set(parsed.data.records.map((record) => record.senderDeviceId))];
    const memberships = await prisma.conversationMember.findMany({
      where: {
        userId: { in: [session.sub, ...senderUserIds] },
        conversationId: { in: conversationIds },
      },
      select: { conversationId: true, userId: true },
    });
    const memberPairs = new Set(memberships.map((item: { conversationId: string; userId: string }) =>
      `${item.conversationId}:${item.userId}`,
    ));
    if (
      conversationIds.some((conversationId) =>
        !memberPairs.has(`${conversationId}:${session.sub}`),
      ) ||
      parsed.data.records.some((record) =>
        !memberPairs.has(`${record.conversationId}:${record.senderUserId}`),
      )
    ) {
      return reply.code(403).send({ error: "Archive records include an unknown conversation member." });
    }

    const senderDevices = await prisma.device.findMany({
      where: { id: { in: senderDeviceIds } },
      select: { id: true, userId: true },
    });
    const senderByDevice = new Map(
      senderDevices.map((device: { id: string; userId: string }) => [device.id, device.userId]),
    );
    if (parsed.data.records.some((record) =>
      senderByDevice.get(record.senderDeviceId) !== record.senderUserId,
    )) {
      return reply.code(400).send({ error: "Archive record sender does not match its device." });
    }

    const deletedArchives = await prisma.messageDeletion.findMany({
      where: {
        logicalMessageId: {
          in: parsed.data.records.map((record) => record.logicalMessageId),
        },
      },
      select: { conversationId: true, logicalMessageId: true },
    });
    const deletedArchiveKeys = new Set(deletedArchives.map((record: {
      conversationId: string;
      logicalMessageId: string;
    }) => `${record.conversationId}:${record.logicalMessageId}`));
    const archiveRecords = parsed.data.records.filter((record) =>
      !deletedArchiveKeys.has(`${record.conversationId}:${record.logicalMessageId}`),
    );

    await prisma.accountArchiveMessage.createMany({
      data: archiveRecords.map((record) => ({
        ownerUserId: session.sub,
        logicalMessageId: record.logicalMessageId,
        conversationId: record.conversationId,
        senderUserId: record.senderUserId,
        senderDeviceId: record.senderDeviceId,
        ephemeralPublicKey: b64ToBytes(record.ephemeralPublicKey),
        nonce: b64ToBytes(record.nonce),
        ciphertext: b64ToBytes(record.ciphertext),
        createdAt: new Date(record.createdAt),
      })),
      skipDuplicates: true,
    });
    return { ok: true };
  });

  app.get("/devices/recovery-vaults", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const backups = await prisma.deviceBackup.findMany({
      where: {
        kind: "vault",
        device: { userId: session.sub, revokedAt: null },
      },
      select: { deviceId: true, payload: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    return { backups };
  });

  app.put("/devices/:deviceId/recovery-vault", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const { deviceId } = request.params as { deviceId: string };
    const parsed = deviceVaultBackupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid encrypted recovery vault." });
    }

    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId: session.sub, revokedAt: null },
      select: { id: true, user: { select: { vaultVersion: true } } },
    });
    if (!device) return reply.code(404).send({ error: "Device not found." });
    if (
      parsed.data.vault.version !== device.user.vaultVersion ||
      (parsed.data.vault.userId && parsed.data.vault.userId !== session.sub)
    ) {
      return reply.code(409).send({ error: "Recovery vault version does not match this account." });
    }

    await prisma.deviceBackup.upsert({
      where: {
        deviceId_kind_recordId: {
          deviceId,
          kind: "vault",
          recordId: deviceId,
        },
      },
      create: {
        deviceId,
        kind: "vault",
        recordId: deviceId,
        payload: parsed.data.vault,
      },
      update: { payload: parsed.data.vault },
    });
    return { ok: true };
  });

  app.get("/devices/:deviceId/recovery-records", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const { deviceId } = request.params as { deviceId: string };
    const parsed = listDeviceBackupsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid recovery backup query." });
    }

    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId: session.sub, revokedAt: null },
      select: { id: true },
    });
    if (!device) return reply.code(404).send({ error: "Device not found." });

    const records = await prisma.deviceBackup.findMany({
      where: {
        deviceId,
        kind: parsed.data.kind,
        ...(parsed.data.after ? { recordId: { gt: parsed.data.after } } : {}),
      },
      select: { recordId: true, conversationId: true, payload: true },
      orderBy: { recordId: "asc" },
      take: parsed.data.limit,
    });
    return { records };
  });

  app.post("/devices/:deviceId/recovery-records/:kind", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");

    const { deviceId, kind } = request.params as { deviceId: string; kind: string };
    if (kind !== "message" && kind !== "session") {
      return reply.code(404).send({ error: "Recovery backup type not found." });
    }
    const parsed = saveDeviceBackupsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid encrypted recovery records." });
    }

    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId: session.sub, revokedAt: null },
      select: { id: true },
    });
    if (!device) return reply.code(404).send({ error: "Device not found." });

    const conversationIds = [
      ...new Set(parsed.data.records.flatMap((record) =>
        record.conversationId ? [record.conversationId] : [],
      )),
    ];
    if (conversationIds.length > 0) {
      const memberships = await prisma.conversationMember.findMany({
        where: {
          userId: session.sub,
          conversationId: { in: conversationIds },
        },
        select: { conversationId: true },
      });
      if (memberships.length !== conversationIds.length) {
        return reply.code(403).send({ error: "Recovery records include an unknown conversation." });
      }
    }

    const recordIds = parsed.data.records.map((record) => record.recordId);
    const deletedMessages = kind === "message"
      ? await prisma.messageDeletion.findMany({
          where: {
            OR: [
              { logicalMessageId: { in: recordIds } },
              { messageRecordIds: { hasSome: recordIds } },
            ],
          },
          select: { logicalMessageId: true, messageRecordIds: true },
        })
      : [];
    const deletedMessageRecordIds = new Set<string>();
    for (const deletion of deletedMessages) {
      deletedMessageRecordIds.add(deletion.logicalMessageId);
      for (const messageRecordId of deletion.messageRecordIds) {
        deletedMessageRecordIds.add(messageRecordId);
      }
    }
    const recordsToSave = parsed.data.records.filter(
      (record) => !deletedMessageRecordIds.has(record.recordId),
    );

    await prisma.$transaction(
      recordsToSave.map((record) =>
        prisma.deviceBackup.upsert({
          where: {
            deviceId_kind_recordId: {
              deviceId,
              kind,
              recordId: record.recordId,
            },
          },
          create: {
            deviceId,
            kind,
            recordId: record.recordId,
            conversationId: record.conversationId,
            payload: {
              nonce: record.nonce,
              ciphertext: record.ciphertext,
              createdAt: record.createdAt,
            },
          },
          update: {
            conversationId: record.conversationId,
            payload: {
              nonce: record.nonce,
              ciphertext: record.ciphertext,
              createdAt: record.createdAt,
            },
          },
        }),
      ),
    );
    return { ok: true };
  });

  app.post("/devices", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = registerDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid device payload" });
    }

    const body = parsed.data;
    const device = await prisma.device.create({
      data: {
        userId: session.sub,
        deviceName: body.deviceName,
        identityPublicKey: b64ToBytes(body.identityPublicKey),
        signingPublicKey: b64ToBytes(body.signingPublicKey),
        signedPreKeyId: body.signedPreKeyId,
        signedPreKey: b64ToBytes(body.signedPreKey),
        signedPreKeySig: b64ToBytes(body.signedPreKeySig),
        lastSeenAt: new Date(),
        oneTimePreKeys: {
          create: body.oneTimePreKeys.map((key) => ({
            keyId: key.keyId,
            publicKey: b64ToBytes(key.publicKey),
          })),
        },
      },
    });

    return { deviceId: device.id };
  });

  app.post("/devices/:deviceId/prekeys", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { deviceId } = request.params as { deviceId: string };
    const parsed = replenishPreKeysSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid prekey payload" });
    }

    const device = await prisma.device.findFirst({
      where: {
        id: deviceId,
        userId: session.sub,
        revokedAt: null,
      },
    });
    if (!device) return reply.code(404).send({ error: "Device not found" });

    await prisma.oneTimePreKey.createMany({
      data: parsed.data.oneTimePreKeys.map((key) => ({
        deviceId,
        keyId: key.keyId,
        publicKey: b64ToBytes(key.publicKey),
      })),
      skipDuplicates: true,
    });

    return { ok: true };
  });

  app.get("/users/:username/prekey-bundle", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsedQuery = prekeyBundleQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: "Invalid device selection" });
    }

    const { username } = request.params as { username: string };
    const targetDeviceId = parsedQuery.data.deviceId;
    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: {
        devices: {
          where: {
            revokedAt: null,
            ...(targetDeviceId ? { id: targetDeviceId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (user.devices.length === 0) {
      if (targetDeviceId) {
        return reply.code(404).send({ error: "Active device not found" });
      }
      return reply.code(409).send({
        error:
          "This account has no active messaging device yet. Ask the account owner to sign in and unlock the app on their device, then try again. If they recently reset their password, they must sign in again to register a new device.",
      });
    }

    const device = user.devices[0];
    const otk = await prisma.$transaction(async (tx: any) => {
      const key = await tx.oneTimePreKey.findFirst({
        where: { deviceId: device.id },
        orderBy: { keyId: "asc" },
      });
      if (key) {
        await tx.oneTimePreKey.delete({ where: { id: key.id } });
      }
      return key;
    });

    return {
      user: publicUser(user),
      deviceId: device.id,
      identityPublicKey: bytesToB64(device.identityPublicKey),
      signingPublicKey: bytesToB64(device.signingPublicKey),
      signedPreKeyId: device.signedPreKeyId,
      signedPreKey: bytesToB64(device.signedPreKey),
      signedPreKeySig: bytesToB64(device.signedPreKeySig),
      oneTimePreKey: otk
        ? { keyId: otk.keyId, publicKey: bytesToB64(otk.publicKey) }
        : null,
    };
  });
}

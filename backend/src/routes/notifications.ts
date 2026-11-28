import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { presenceExpiry } from "../notifications-dispatch.js";
import { consumeRateLimit, pruneRateLimits, type RateBucket } from "../rate-limit.js";

const deviceBuckets = new Map<string, RateBucket>();

const deviceSchema = z.object({
  platform: z.enum(["ios", "android", "web"]),
  token: z.string().trim().min(8).max(2_000),
  keys: z.object({
    endpoint: z.string().url().max(2_000),
    p256dh: z.string().trim().min(8).max(256),
    auth: z.string().trim().min(4).max(256),
  }).strict().optional(),
}).strict();

const tokenSchema = z.object({
  token: z.string().trim().min(8).max(2_000),
}).strict();

const settingsSchema = z.object({
  hidePreviews: z.boolean(),
}).strict();

const presenceSchema = z.object({
  conversationId: z.string().uuid().nullable(),
  foreground: z.boolean(),
}).strict();

const muteSchema = z.object({
  muted: z.boolean(),
  mutedUntil: z.string().datetime().nullable().optional(),
}).strict();

function webEndpoint(keys: { endpoint: string } | undefined, platform: string): boolean {
  if (platform !== "web") return true;
  if (!keys) return false;
  try {
    const url = new URL(keys.endpoint);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function notificationRoutes(app: FastifyInstance) {
  app.post("/notifications/devices", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const parsed = deviceSchema.safeParse(request.body);
    if (!parsed.success || !webEndpoint(parsed.data?.keys, parsed.data?.platform ?? "")) {
      return reply.code(400).send({ error: "Invalid push device." });
    }
    if (parsed.data.platform === "web" && !parsed.data.keys) {
      return reply.code(400).send({ error: "Web push requires a subscription." });
    }
    const now = Date.now();
    pruneRateLimits(deviceBuckets, 60 * 60 * 1000, now);
    const rate = consumeRateLimit(deviceBuckets, `device:${session.sub}`, 40, 60 * 60 * 1000, now);
    if (!rate.ok) return reply.code(429).send({ error: "Too many device updates. Try again later." });
    await prisma.pushDevice.updateMany({
      where: { token: parsed.data.token, userId: { not: session.sub } },
      data: { revokedAt: new Date() },
    });
    const keys = parsed.data.keys
      ? { endpoint: parsed.data.keys.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth }
      : undefined;
    const device = await prisma.pushDevice.upsert({
      where: { userId_token: { userId: session.sub, token: parsed.data.token } },
      create: {
        userId: session.sub,
        platform: parsed.data.platform,
        token: parsed.data.token,
        keys,
      },
      update: {
        platform: parsed.data.platform,
        keys,
        revokedAt: null,
        lastSeenAt: new Date(),
      },
    });
    return { id: device.id, platform: device.platform };
  });

  app.delete("/notifications/devices", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const parsed = tokenSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid push device." });
    await prisma.pushDevice.updateMany({
      where: { userId: session.sub, token: parsed.data.token, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });

  app.get("/notifications/settings", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const [pref, state, devices] = await Promise.all([
      prisma.notificationPreference.findUnique({ where: { userId: session.sub } }),
      prisma.notificationState.findUnique({ where: { userId: session.sub } }),
      prisma.pushDevice.count({ where: { userId: session.sub, revokedAt: null } }),
    ]);
    return {
      hidePreviews: pref?.hidePreviews ?? true,
      badgeCount: state?.badgeCount ?? 0,
      devices,
      webPushConfigured: Boolean(env.VAPID_PUBLIC_KEY),
      vapidPublicKey: env.VAPID_PUBLIC_KEY ?? null,
    };
  });

  app.put("/notifications/settings", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid notification settings." });
    await prisma.notificationPreference.upsert({
      where: { userId: session.sub },
      create: { userId: session.sub, hidePreviews: parsed.data.hidePreviews },
      update: { hidePreviews: parsed.data.hidePreviews },
    });
    return { hidePreviews: parsed.data.hidePreviews };
  });

  app.put("/notifications/presence", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const parsed = presenceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid presence." });
    if (parsed.data.conversationId) {
      const member = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: { conversationId: parsed.data.conversationId, userId: session.sub },
        },
        select: { userId: true },
      });
      if (!member) return reply.code(404).send({ error: "Conversation not found." });
    }
    const expiry = presenceExpiry();
    await prisma.notificationState.upsert({
      where: { userId: session.sub },
      create: {
        userId: session.sub,
        openConversationId: parsed.data.conversationId,
        openUntil: parsed.data.conversationId ? expiry : null,
        foregroundUntil: parsed.data.foreground ? expiry : null,
      },
      update: {
        openConversationId: parsed.data.conversationId,
        openUntil: parsed.data.conversationId ? expiry : null,
        foregroundUntil: parsed.data.foreground ? expiry : null,
      },
    });
    return { ok: true };
  });

  app.post("/notifications/badge/clear", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    await prisma.notificationState.upsert({
      where: { userId: session.sub },
      create: { userId: session.sub, badgeCount: 0 },
      update: { badgeCount: 0 },
    });
    return { badgeCount: 0 };
  });

  app.put("/notifications/mutes/:conversationId", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { conversationId } = request.params as { conversationId: string };
    if (!z.string().uuid().safeParse(conversationId).success) {
      return reply.code(400).send({ error: "Invalid conversation." });
    }
    const parsed = muteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid mute." });
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: session.sub } },
      select: { userId: true },
    });
    if (!member) return reply.code(404).send({ error: "Conversation not found." });
    if (!parsed.data.muted) {
      await prisma.conversationMute.deleteMany({
        where: { userId: session.sub, conversationId },
      });
      return { muted: false, mutedUntil: null };
    }
    const mutedUntil = parsed.data.mutedUntil ? new Date(parsed.data.mutedUntil) : null;
    await prisma.conversationMute.upsert({
      where: { userId_conversationId: { userId: session.sub, conversationId } },
      create: { userId: session.sub, conversationId, mutedUntil },
      update: { mutedUntil },
    });
    return { muted: true, mutedUntil: mutedUntil?.toISOString() ?? null };
  });
}

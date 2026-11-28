import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { consumeRateLimit, pruneRateLimits, type RateBucket } from "../rate-limit.js";
import { GALLERY_PAGE_MAX, THEMES_PER_USER_MAX, screenThemeText, themeJsonTooLarge } from "../theme-content.js";
import { generateThemeForUser } from "../theme-generate.js";
import { acceptTheme } from "../theme-tokens.js";

const writeBuckets = new Map<string, RateBucket>();
const generateBuckets = new Map<string, RateBucket>();
const REPORT_FLAG_THRESHOLD = 3;
const WRITE_LIMIT = 30;
const WRITE_WINDOW_MS = 60 * 60 * 1000;

const generateSchema = z.object({
  prompt: z.string(),
  tweak: z.string().optional(),
  previous: z.unknown().optional(),
}).strict();

const saveSchema = z.object({
  prompt: z.string(),
  theme: z.unknown(),
}).strict();

const publishSchema = z.object({
  published: z.boolean(),
}).strict();

const reportSchema = z.object({
  reason: z.enum(["spam", "offensive", "copyright", "other"]),
}).strict();

const applySchema = z.object({
  themeId: z.string().uuid(),
  scope: z.enum(["app", "chat"]),
  conversationId: z.string().uuid().optional(),
  wallpaperOnly: z.boolean().optional(),
}).strict();

const clearSchema = z.object({
  scope: z.enum(["app", "chat"]),
  conversationId: z.string().uuid().optional(),
}).strict();

type ThemeRow = {
  id: string;
  ownerUserId: string;
  name: string;
  emoji: string;
  prompt: string;
  tokens: unknown;
  published: boolean;
  flagged: boolean;
  likeCount: number;
  createdAt: Date;
};

function publicTheme(row: ThemeRow, viewerId: string, liked: boolean) {
  const mine = row.ownerUserId === viewerId;
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    tokens: row.tokens,
    published: row.published,
    flagged: row.flagged,
    likeCount: row.likeCount,
    liked,
    mine,
    createdAt: row.createdAt.toISOString(),
    ...(mine ? { prompt: row.prompt } : {}),
  };
}

function takeWrite(userId: string, now: number) {
  pruneRateLimits(writeBuckets, WRITE_WINDOW_MS, now);
  return consumeRateLimit(writeBuckets, `theme-write:${userId}`, WRITE_LIMIT, WRITE_WINDOW_MS, now);
}

async function ownedTheme(userId: string, themeId: string) {
  return prisma.themeRecord.findFirst({
    where: { id: themeId, ownerUserId: userId },
  });
}

export async function themeRoutes(app: FastifyInstance) {
  app.post("/themes/generate", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Describe the theme in a few words." });
    const result = await generateThemeForUser({
      userId: session.sub,
      prompt: parsed.data.prompt,
      tweak: parsed.data.tweak,
      previous: parsed.data.previous,
      now: Date.now(),
      buckets: generateBuckets,
      config: {
        apiKey: env.SOPHIA_MODEL_API_KEY,
        baseUrl: env.SOPHIA_MODEL_BASE_URL,
        model: env.SOPHIA_MODEL_NAME,
      },
    });
    request.log.info({ userId: session.sub, outcome: result.ok ? "ok" : "rejected", status: result.status }, "theme generate");
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return {
      theme: result.theme,
      adjustments: result.adjustments,
      source: result.source,
    };
  });

  app.post("/themes", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid theme." });
    const prompt = screenThemeText(parsed.data.prompt, 180);
    if (!prompt.ok) return reply.code(400).send({ error: prompt.error });
    const accepted = acceptTheme(parsed.data.theme);
    if (!accepted.ok) return reply.code(400).send({ error: accepted.error });
    if (themeJsonTooLarge(accepted.theme)) return reply.code(400).send({ error: "That theme is too large." });
    const nameScreen = screenThemeText(accepted.theme.name, 32);
    if (!nameScreen.ok) return reply.code(400).send({ error: nameScreen.error });
    const rate = takeWrite(session.sub, Date.now());
    if (!rate.ok) return reply.code(429).send({ error: "Too many theme saves. Try again later." });
    const count = await prisma.themeRecord.count({ where: { ownerUserId: session.sub } });
    if (count >= THEMES_PER_USER_MAX) {
      return reply.code(400).send({ error: `You can save up to ${THEMES_PER_USER_MAX} themes.` });
    }
    const saved = await prisma.themeRecord.create({
      data: {
        ownerUserId: session.sub,
        name: accepted.theme.name,
        emoji: accepted.theme.emoji,
        prompt: prompt.text,
        tokens: accepted.theme as Prisma.InputJsonValue,
      },
    });
    return publicTheme(saved as ThemeRow, session.sub, false);
  });

  app.get("/themes", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const rows = await prisma.themeRecord.findMany({
      where: { ownerUserId: session.sub },
      orderBy: { updatedAt: "desc" },
      take: THEMES_PER_USER_MAX,
    });
    return { themes: rows.map((row) => publicTheme(row as ThemeRow, session.sub, false)) };
  });

  app.delete("/themes/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const existing = await ownedTheme(session.sub, id);
    if (!existing) return reply.code(404).send({ error: "Theme not found." });
    await prisma.themeRecord.delete({ where: { id } });
    return { ok: true };
  });

  app.patch("/themes/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = publishSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid theme update." });
    const existing = await ownedTheme(session.sub, id);
    if (!existing) return reply.code(404).send({ error: "Theme not found." });
    if (parsed.data.published) {
      if (existing.flagged) return reply.code(403).send({ error: "This theme was flagged and cannot be published." });
      const nameScreen = screenThemeText(existing.name, 32);
      if (!nameScreen.ok) return reply.code(400).send({ error: nameScreen.error });
      const promptScreen = screenThemeText(existing.prompt, 180);
      if (!promptScreen.ok) return reply.code(400).send({ error: promptScreen.error });
    }
    const updated = await prisma.themeRecord.update({
      where: { id },
      data: { published: parsed.data.published },
    });
    return publicTheme(updated as ThemeRow, session.sub, false);
  });

  app.get("/themes/gallery", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const query = z.object({
      q: z.string().trim().max(40).optional(),
      cursor: z.string().max(80).optional(),
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid gallery query." });
    const q = query.data.q?.trim();
    if (q) {
      const screened = screenThemeText(q, 40);
      if (!screened.ok) return reply.code(400).send({ error: screened.error });
    }
    let cursor: { likeCount: number; id: string } | null = null;
    if (query.data.cursor) {
      const decoded = Buffer.from(query.data.cursor, "base64url").toString("utf8");
      const splitAt = decoded.indexOf(":");
      const like = Number(decoded.slice(0, splitAt));
      const id = decoded.slice(splitAt + 1);
      if (splitAt <= 0 || !Number.isInteger(like) || !z.string().uuid().safeParse(id).success) {
        return reply.code(400).send({ error: "Invalid gallery query." });
      }
      cursor = { likeCount: like, id };
    }
    const rows = await prisma.themeRecord.findMany({
      where: {
        published: true,
        flagged: false,
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
        ...(cursor
          ? {
              OR: [
                { likeCount: { lt: cursor.likeCount } },
                { likeCount: cursor.likeCount, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ likeCount: "desc" }, { id: "desc" }],
      take: GALLERY_PAGE_MAX,
    });
    const likes = rows.length === 0
      ? []
      : await prisma.themeLike.findMany({
          where: { userId: session.sub, themeId: { in: rows.map((row) => row.id) } },
          select: { themeId: true },
        });
    const likedIds = new Set(likes.map((like) => like.themeId));
    const last = rows.at(-1);
    const nextCursor = rows.length === GALLERY_PAGE_MAX && last
      ? Buffer.from(`${last.likeCount}:${last.id}`).toString("base64url")
      : null;
    return {
      themes: rows.map((row) => publicTheme(row as ThemeRow, session.sub, likedIds.has(row.id))),
      nextCursor,
    };
  });

  app.post("/themes/:id/like", async (request, reply) => {
    return setLike(request, reply, true);
  });

  app.delete("/themes/:id/like", async (request, reply) => {
    return setLike(request, reply, false);
  });

  app.post("/themes/:id/report", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = reportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid report." });
    const theme = await prisma.themeRecord.findFirst({
      where: { id, published: true },
    });
    if (!theme || theme.ownerUserId === session.sub) {
      return reply.code(404).send({ error: "Theme not found." });
    }
    await prisma.themeReport.upsert({
      where: { themeId_userId: { themeId: id, userId: session.sub } },
      create: { themeId: id, userId: session.sub, reason: parsed.data.reason },
      update: { reason: parsed.data.reason },
    });
    const reports = await prisma.themeReport.count({ where: { themeId: id } });
    if (reports >= REPORT_FLAG_THRESHOLD) {
      await prisma.themeRecord.update({ where: { id }, data: { flagged: true } });
    }
    return { ok: true, flagged: reports >= REPORT_FLAG_THRESHOLD };
  });

  app.post("/themes/:id/install", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const theme = await prisma.themeRecord.findFirst({
      where: { id, published: true, flagged: false },
    });
    if (!theme) return reply.code(404).send({ error: "Theme not found." });
    if (theme.ownerUserId === session.sub) return publicTheme(theme as ThemeRow, session.sub, false);
    const accepted = acceptTheme(theme.tokens);
    if (!accepted.ok) return reply.code(400).send({ error: "That theme can no longer be installed." });
    const rate = takeWrite(session.sub, Date.now());
    if (!rate.ok) return reply.code(429).send({ error: "Too many theme saves. Try again later." });
    const count = await prisma.themeRecord.count({ where: { ownerUserId: session.sub } });
    if (count >= THEMES_PER_USER_MAX) {
      return reply.code(400).send({ error: `You can save up to ${THEMES_PER_USER_MAX} themes.` });
    }
    const saved = await prisma.themeRecord.create({
      data: {
        ownerUserId: session.sub,
        name: accepted.theme.name,
        emoji: accepted.theme.emoji,
        prompt: "Installed from the gallery",
        tokens: accepted.theme as Prisma.InputJsonValue,
        sourceThemeId: theme.id,
      },
    });
    return publicTheme(saved as ThemeRow, session.sub, false);
  });

  app.get("/themes/applied", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const rows = await prisma.themeApplication.findMany({
      where: { userId: session.sub },
      include: { theme: true },
    });
    const appTheme = rows.find((row) => row.scope === "app");
    const chats = rows.filter((row) => row.scope === "chat" && row.conversationId);
    return {
      app: appTheme ? { wallpaperOnly: appTheme.wallpaperOnly, theme: publicTheme(appTheme.theme as ThemeRow, session.sub, false) } : null,
      chats: chats.map((row) => ({
        conversationId: row.conversationId,
        wallpaperOnly: row.wallpaperOnly,
        theme: publicTheme(row.theme as ThemeRow, session.sub, false),
      })),
    };
  });

  app.put("/themes/applied", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const parsed = applySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid theme application." });
    if (parsed.data.scope === "chat" && !parsed.data.conversationId) {
      return reply.code(400).send({ error: "Choose a conversation for a chat wallpaper." });
    }
    const theme = await ownedTheme(session.sub, parsed.data.themeId);
    if (!theme) return reply.code(404).send({ error: "Theme not found." });
    const conversationId = parsed.data.scope === "chat" ? parsed.data.conversationId! : "";
    if (conversationId) {
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId: session.sub } },
        select: { userId: true },
      });
      if (!member) return reply.code(404).send({ error: "Conversation not found." });
    }
    await prisma.themeApplication.upsert({
      where: {
        userId_scope_conversationId: {
          userId: session.sub,
          scope: parsed.data.scope,
          conversationId,
        },
      },
      create: {
        userId: session.sub,
        scope: parsed.data.scope,
        conversationId,
        themeId: theme.id,
        wallpaperOnly: parsed.data.wallpaperOnly ?? parsed.data.scope === "chat",
      },
      update: {
        themeId: theme.id,
        wallpaperOnly: parsed.data.wallpaperOnly ?? parsed.data.scope === "chat",
      },
    });
    return { ok: true };
  });

  app.delete("/themes/applied", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const parsed = clearSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid theme application." });
    const conversationId = parsed.data.scope === "chat" ? parsed.data.conversationId ?? "" : "";
    await prisma.themeApplication.deleteMany({
      where: { userId: session.sub, scope: parsed.data.scope, conversationId },
    });
    return { ok: true };
  });
}

async function setLike(request: FastifyRequest, reply: FastifyReply, like: boolean) {
  const session = await requireUser(request, reply);
  if (!session) return;
  const { id } = request.params as { id: string };
  const theme = await prisma.themeRecord.findFirst({
    where: { id, published: true, flagged: false },
  });
  if (!theme) return reply.code(404).send({ error: "Theme not found." });
  const existing = await prisma.themeLike.findUnique({
    where: { themeId_userId: { themeId: id, userId: session.sub } },
  });
  if (like && !existing) {
    await prisma.$transaction([
      prisma.themeLike.create({ data: { themeId: id, userId: session.sub } }),
      prisma.themeRecord.update({ where: { id }, data: { likeCount: { increment: 1 } } }),
    ]);
  } else if (!like && existing) {
    await prisma.$transaction([
      prisma.themeLike.delete({ where: { themeId_userId: { themeId: id, userId: session.sub } } }),
      prisma.themeRecord.update({ where: { id }, data: { likeCount: { decrement: 1 } } }),
    ]);
  }
  const updated = await prisma.themeRecord.findUnique({ where: { id } });
  return { liked: like, likeCount: Math.max(0, updated?.likeCount ?? 0) };
}

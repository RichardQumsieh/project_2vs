import type { FastifyInstance } from "fastify";
import {
  activityListFilter,
  activityWriteOwner,
  sanitizeActivityWrite,
  toActivityExport,
} from "../account-activity.js";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { recordActivitySchema } from "../schemas.js";

const listLimit = 100;
const exportLimit = 2_000;

function publicEvent(event: {
  id: string;
  actorUserId: string;
  actorLabel: string;
  action: string;
  summary: string;
  subjectKind: string | null;
  subjectId: string | null;
  occurredAt: Date;
}) {
  return {
    id: event.id,
    actorUserId: event.actorUserId,
    actor: event.actorLabel,
    occurredAt: event.occurredAt.toISOString(),
    action: event.action,
    summary: event.summary,
    subjectKind: event.subjectKind,
    subjectId: event.subjectId,
  };
}

export async function accountActivityRoutes(app: FastifyInstance) {
  app.get("/account/activity", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    const rows = await prisma.accountActivityEvent.findMany({
      where: activityListFilter(session.sub),
      orderBy: { occurredAt: "desc" },
      take: listLimit + 1,
    });
    return {
      events: rows.slice(0, listLimit).map(publicEvent),
      truncated: rows.length > listLimit,
      recorded: [
        "Sign-in",
        "Cloud Sophia consent granted or withdrawn",
        "Settings changes from the consent and activity controls",
        "Approved email sends",
        "Approved email drafts",
        "Approved calendar reschedules",
        "Approved calendar deletes",
        "Workspace creation, invites, and membership changes",
      ],
      notRecorded: [
        "Private message bodies",
        "Email bodies, subjects, and recipients",
        "Tokens, passwords, and prompt text",
        "Invite codes and links",
        "Buttons that are not wired to this log",
      ],
    };
  });

  app.get("/account/activity/export", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    reply.header(
      "Content-Disposition",
      'attachment; filename="sophia-activity-log.json"',
    );
    const rows = await prisma.accountActivityEvent.findMany({
      where: activityListFilter(session.sub),
      orderBy: { occurredAt: "asc" },
      take: exportLimit + 1,
    });
    const truncated = rows.length > exportLimit;
    const document = toActivityExport({
      ownerUserId: session.sub,
      exportedAt: new Date().toISOString(),
      events: rows.slice(0, exportLimit).map((event) => ({
        id: event.id,
        actorUserId: event.actorUserId,
        actorLabel: event.actorLabel,
        occurredAt: event.occurredAt.toISOString(),
        action: event.action,
        summary: event.summary,
        subjectKind: event.subjectKind,
        subjectId: event.subjectId,
      })),
    });
    return { ...document, truncated };
  });

  app.delete("/account/activity", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    const deleted = await prisma.accountActivityEvent.deleteMany({
      where: activityListFilter(session.sub),
    });
    return { ok: true as const, deleted: deleted.count };
  });

  app.post(
    "/account/activity",
    {
      bodyLimit: 2 * 1024,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      reply.header("Cache-Control", "no-store");
      const parsed = recordActivitySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid activity event" });
      }
      const owner = activityWriteOwner(session.sub);
      const sanitized = sanitizeActivityWrite({
        ...owner,
        actorLabel: session.username,
        action: parsed.data.action,
        summary: parsed.data.summary,
        subjectKind: parsed.data.subjectKind ?? null,
        subjectId: parsed.data.subjectId ?? null,
      });
      if (!sanitized.ok) {
        return reply.code(400).send({ error: sanitized.error });
      }
      const event = await prisma.accountActivityEvent.create({
        data: sanitized.data,
      });
      return reply.code(201).send({ event: publicEvent(event) });
    },
  );
}

import type { FastifyInstance } from "fastify";
import { tryRecordAccountActivity } from "../account-activity-store.js";
import { requireUser } from "../auth.js";
import {
  consentIsActive,
  executeCloudModelCall,
  isHttpsModelBaseUrl,
  type CloudConsentSnapshot,
} from "../cloud-sophia-policy.js";
import { prisma } from "../db.js";
import { createPrismaDailyBriefRepository } from "../daily-brief-store.js";
import {
  generateDailyBriefNow,
  publicBriefLog,
  readDailyBrief,
  runDueDailyBriefs,
  saveDailyBriefPreference,
  type BriefActivity,
} from "../daily-brief-service.js";
import type { BriefAssistant } from "../daily-brief.js";
import { dailyBriefEnabled, env } from "../env.js";

const repo = createPrismaDailyBriefRepository();

function modelName() {
  return env.SOPHIA_MODEL_NAME ?? "grok-4";
}

async function assistantFor(userId: string, log: (fields: object) => void): Promise<BriefAssistant> {
  const apiKey = env.SOPHIA_MODEL_API_KEY;
  const baseUrl = env.SOPHIA_MODEL_BASE_URL;
  if (!apiKey || !isHttpsModelBaseUrl(baseUrl)) return { mode: "mock" };
  const row = await prisma.cloudSophiaConsent.findFirst({
    where: { userId },
    orderBy: { grantedAt: "desc" },
  });
  const consent: CloudConsentSnapshot | null = row
    ? {
        userId: row.userId,
        purposeText: row.purposeText,
        versionId: row.versionId,
        withdrawnAt: row.withdrawnAt,
      }
    : null;
  if (!consentIsActive(consent, userId)) return { mode: "mock" };
  return {
    mode: "live",
    async complete({ prompt, contextLines }) {
      const result = await executeCloudModelCall({
        sessionUserId: userId,
        consent,
        apiKey,
        baseUrl,
        model: modelName(),
        prompt,
        contextLines,
        fetchImpl: (url, init) => fetch(url, init),
        log: (fields) => log(fields),
      });
      return result.body.reply ?? null;
    },
  };
}

function activityFor(userId: string, actorLabel: string): BriefActivity {
  return async (summary, action) => {
    await tryRecordAccountActivity({
      ownerUserId: userId,
      actorUserId: userId,
      actorLabel,
      action,
      summary,
      subjectKind: "setting",
      subjectId: "daily-brief",
    });
  };
}

function sendResult(
  reply: { code: (status: number) => { send: (body: unknown) => unknown }; header: (name: string, value: string) => void },
  result: { ok: true; status: number; body: unknown } | { ok: false; status: number; error: string; code: string },
) {
  reply.header("Cache-Control", "no-store");
  if (!result.ok) {
    return reply.code(result.status).send({ error: result.error, code: result.code });
  }
  return reply.code(result.status).send(result.body);
}

let schedulerStarted = false;

/** Prepares due briefs once a minute. No-ops while the feature flag is off. */
export function startDailyBriefScheduler(log: (fields: object) => void) {
  if (schedulerStarted || !dailyBriefEnabled) return;
  schedulerStarted = true;
  const tick = () => {
    void runDueDailyBriefs({
      enabled: dailyBriefEnabled,
      now: new Date(),
      repo,
      assistantFor: (userId) => assistantFor(userId, log),
      recordActivity: async (userId) => {
        await tryRecordAccountActivity({
          ownerUserId: userId,
          actorUserId: userId,
          actorLabel: "sophia",
          action: "BUTTON_ACTION",
          summary: "Prepared the daily brief",
          subjectKind: "setting",
          subjectId: "daily-brief",
        });
      },
    }).then(
      (counts) => log({ dailyBriefScheduler: true, ...counts }),
      () => log({ dailyBriefScheduler: true, outcome: "error" }),
    );
  };
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
}

export async function dailyBriefRoutes(app: FastifyInstance) {
  app.get("/daily-brief", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    try {
      const result = await readDailyBrief({
        enabled: dailyBriefEnabled,
        userId: session.sub,
        now: new Date(),
        repo,
        assistant: await assistantFor(session.sub, (fields) => {
          request.log.info(fields, "daily brief model");
        }),
        recordActivity: activityFor(session.sub, session.username),
      });
      if (result.ok && result.body.brief) {
        request.log.info(publicBriefLog(result.body.brief), "daily brief");
      } else {
        request.log.info({ dailyBrief: true, outcome: result.ok ? "empty" : result.code }, "daily brief");
      }
      return sendResult(reply, result);
    } catch {
      request.log.info({ dailyBrief: true, outcome: "error" }, "daily brief");
      reply.header("Cache-Control", "no-store");
      return reply.code(503).send({
        error: "The daily brief could not be prepared.",
        code: "daily_brief_unavailable",
      });
    }
  });

  app.post(
    "/daily-brief",
    { bodyLimit: 1024, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      try {
        const result = await generateDailyBriefNow({
          enabled: dailyBriefEnabled,
          userId: session.sub,
          now: new Date(),
          repo,
          assistant: await assistantFor(session.sub, (fields) => {
            request.log.info(fields, "daily brief model");
          }),
          recordActivity: activityFor(session.sub, session.username),
        });
        if (result.ok && result.body.brief) {
          request.log.info(publicBriefLog(result.body.brief), "daily brief");
        }
        return sendResult(reply, result);
      } catch {
        request.log.info({ dailyBrief: true, outcome: "error" }, "daily brief");
        reply.header("Cache-Control", "no-store");
        return reply.code(503).send({
          error: "The daily brief could not be prepared.",
          code: "daily_brief_unavailable",
        });
      }
    },
  );

  app.put(
    "/daily-brief/preferences",
    { bodyLimit: 1024, config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      const result = await saveDailyBriefPreference({
        enabled: dailyBriefEnabled,
        userId: session.sub,
        body: request.body,
        repo,
        recordActivity: activityFor(session.sub, session.username),
      });
      request.log.info(
        { dailyBrief: true, outcome: result.ok ? "preference" : result.code },
        "daily brief preference",
      );
      return sendResult(reply, result);
    },
  );
}

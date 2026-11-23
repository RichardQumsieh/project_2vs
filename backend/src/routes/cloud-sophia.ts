import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { tryRecordAccountActivity } from "../account-activity-store.js";
import {
  CLOUD_SOPHIA_CONSENT_VERSION,
  CLOUD_SOPHIA_PURPOSE,
  buildConnectedContextLines,
  cloudCallLogFields,
  consentIsActive,
  executeCloudModelCall,
  prepareCloudCompletion,
  type ConnectedCloudContext,
} from "../cloud-sophia-policy.js";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { cloudSophiaConsentSchema } from "../schemas.js";

const modelName = () => env.SOPHIA_MODEL_NAME;

function publicConsent(consent: {
  id: string;
  purposeText: string;
  versionId: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
}) {
  return {
    id: consent.id,
    purposeText: consent.purposeText,
    versionId: consent.versionId,
    grantedAt: consent.grantedAt.toISOString(),
    withdrawnAt: consent.withdrawnAt?.toISOString() ?? null,
  };
}

async function latestConsent(userId: string) {
  return prisma.cloudSophiaConsent.findFirst({
    where: { userId },
    orderBy: { grantedAt: "desc" },
  });
}

async function loadConnectedContext(userId: string): Promise<ConnectedCloudContext> {
  const [calendar, mail, work] = await Promise.all([
    prisma.calendarEventMirror.findMany({
      where: { ownerUserId: userId },
      orderBy: { startsAt: "desc" },
      take: 12,
      select: { title: true, startsAt: true, endsAt: true },
    }),
    prisma.mailMessageMirror.findMany({
      where: { ownerUserId: userId },
      orderBy: { receivedAt: "desc" },
      take: 12,
      select: {
        subject: true,
        fromAddress: true,
        receivedAt: true,
        snippet: true,
      },
    }),
    prisma.workItemMirror.findMany({
      where: {
        ownerUserId: userId,
        connection: { provider: { in: ["GITHUB", "LINEAR"] } },
      },
      orderBy: { syncedAt: "desc" },
      take: 12,
      select: {
        title: true,
        state: true,
        number: true,
        connection: { select: { provider: true } },
      },
    }),
  ]);

  return {
    calendar: calendar.map((event) => ({
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
    })),
    mail: mail.map((message) => ({
      subject: message.subject,
      fromAddress: message.fromAddress,
      receivedAt: message.receivedAt.toISOString(),
      snippet: message.snippet,
    })),
    work: work.map((item) => ({
      provider: item.connection.provider === "GITHUB" ? "github" as const : "linear" as const,
      title: item.title,
      state: item.state,
      number: item.number,
    })),
  };
}

export async function cloudSophiaRoutes(app: FastifyInstance) {
  app.get("/sophia/cloud/consent", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    const consent = await latestConsent(session.sub);
    return {
      active: consentIsActive(consent, session.sub),
      purposeText: CLOUD_SOPHIA_PURPOSE,
      versionId: CLOUD_SOPHIA_CONSENT_VERSION,
      consent: consent ? publicConsent(consent) : null,
    };
  });

  app.post(
    "/sophia/cloud/consent",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      reply.header("Cache-Control", "no-store");
      const parsed = cloudSophiaConsentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Cloud Sophia consent text does not match the current version.",
        });
      }
      const existing = await latestConsent(session.sub);
      if (consentIsActive(existing, session.sub)) {
        return { consent: publicConsent(existing!) };
      }
      const consent = await prisma.cloudSophiaConsent.create({
        data: {
          userId: session.sub,
          purposeText: parsed.data.purposeText,
          versionId: parsed.data.versionId,
        },
      });
      await tryRecordAccountActivity({
        ownerUserId: session.sub,
        actorUserId: session.sub,
        actorLabel: session.username,
        action: "CLOUD_CONSENT_GRANTED",
        summary: "Granted cloud Sophia consent",
        subjectKind: "consent",
        subjectId: parsed.data.versionId,
      });
      return reply.code(201).send({ consent: publicConsent(consent) });
    },
  );

  app.post("/sophia/cloud/consent/withdraw", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    const withdrawn = await prisma.cloudSophiaConsent.updateMany({
      where: { userId: session.sub, withdrawnAt: null },
      data: { withdrawnAt: new Date() },
    });
    if (withdrawn.count > 0) {
      await tryRecordAccountActivity({
        ownerUserId: session.sub,
        actorUserId: session.sub,
        actorLabel: session.username,
        action: "CLOUD_CONSENT_WITHDRAWN",
        summary: "Withdrew cloud Sophia consent",
        subjectKind: "consent",
        subjectId: CLOUD_SOPHIA_CONSENT_VERSION,
      });
    }
    return { ok: true as const, withdrawn: withdrawn.count > 0 };
  });

  app.post(
    "/sophia/cloud/complete",
    {
      bodyLimit: 8 * 1024,
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      reply.header("Cache-Control", "no-store");

      const consent = await latestConsent(session.sub);
      const prepared = prepareCloudCompletion({
        body: request.body,
        sessionUserId: session.sub,
        consent,
        apiKey: env.SOPHIA_MODEL_API_KEY,
        baseUrl: env.SOPHIA_MODEL_BASE_URL,
      });
      if (!prepared.ok) {
        if ("outcome" in prepared) {
          request.log.info(
            cloudCallLogFields({
              userId: session.sub,
              outcome: prepared.outcome,
              status: prepared.status,
            }),
            "cloud sophia skipped",
          );
        }
        return reply.code(prepared.status).send({
          error: prepared.error,
          code: prepared.code,
        });
      }

      // Connected metadata is loaded only after the grant and configuration gates pass.
      const contextLines = buildConnectedContextLines(
        await loadConnectedContext(session.sub),
      );
      const result = await executeCloudModelCall({
        sessionUserId: session.sub,
        consent,
        apiKey: env.SOPHIA_MODEL_API_KEY,
        baseUrl: env.SOPHIA_MODEL_BASE_URL,
        model: modelName(),
        prompt: prepared.prompt,
        contextLines,
        fetchImpl: (url, init) => fetch(url, init),
        log: (fields) => {
          request.log.info(fields, "cloud sophia call");
        },
      });
      return reply.code(result.status).send(result.body);
    },
  );
}

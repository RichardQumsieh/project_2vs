import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { tryRecordAccountActivity } from "../account-activity-store.js";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import {
  googleCalendarOAuthConfigured,
  gmailOAuthConfigured,
  microsoftCalendarOAuthConfigured,
  microsoftMailOAuthConfigured,
} from "../env.js";
import {
  providerDelete,
  providerFetch,
  resolveCalendarAccessToken,
  resolveEmailAccessToken,
} from "../integrations/access-token.js";
import { emailWriteBodyLimit } from "../integrations/email-write.js";
import {
  approveMailCalendarWrite,
  auditMetadata,
  directWriteDecision,
  performMailCalendarApproval,
  proposeMailCalendarWrite,
  type ApprovalConnection,
  type ApprovalResponse,
  type MailCalendarProvider,
  type ProviderHttp,
  type ValidatedProposal,
} from "../integrations/mail-calendar-approval.js";
import { createPrismaApprovalStore } from "../integrations/mail-calendar-approval-store.js";
import { isMirrorId } from "../integrations/read-gate.js";
import {
  gateWriteForSession,
  sessionWriteAudience,
} from "../integrations/write-audience.js";

const store = createPrismaApprovalStore();

const providerHttp: ProviderHttp = {
  async request(input) {
    if (input.method === "DELETE") {
      const result = await providerDelete(input.url, input.accessToken);
      return { status: result.status, json: null };
    }
    const result = await providerFetch(input.url, {
      method: input.method,
      accessToken: input.accessToken,
      body: input.body ?? {},
    });
    return { status: result.status, json: result.json };
  },
};

function oauthReady(provider: MailCalendarProvider) {
  switch (provider) {
    case "gmail":
      return gmailOAuthConfigured;
    case "outlook-mail":
      return microsoftMailOAuthConfigured;
    case "google":
      return googleCalendarOAuthConfigured;
    case "outlook":
      return microsoftCalendarOAuthConfigured;
  }
}

function prismaProvider(provider: MailCalendarProvider) {
  switch (provider) {
    case "gmail":
      return "GMAIL" as const;
    case "outlook-mail":
      return "OUTLOOK_MAIL" as const;
    case "google":
      return "GOOGLE_CALENDAR" as const;
    case "outlook":
      return "OUTLOOK_CALENDAR" as const;
  }
}

function asConnection(row: {
  id: string;
  ownerUserId: string;
  status: string;
  scopes: string[];
  refreshTokenEncrypted: string;
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
}): ApprovalConnection {
  return row;
}

async function loadMailConnection(
  ownerUserId: string,
  provider: "gmail" | "outlook-mail",
) {
  const row = await prisma.integrationConnection.findUnique({
    where: {
      ownerUserId_provider: {
        ownerUserId,
        provider: prismaProvider(provider),
      },
    },
  });
  return row ? asConnection(row) : null;
}

async function loadDeleteTarget(
  ownerUserId: string,
  provider: "google" | "outlook",
  eventId: string,
) {
  const event = await prisma.calendarEventMirror.findFirst({
    where: {
      id: eventId,
      ownerUserId,
      connection: { provider: prismaProvider(provider) },
    },
    include: { connection: true },
  });
  if (!event) return null;
  return {
    connection: asConnection(event.connection),
    calendarId: event.calendarId,
    externalEventId: event.externalEventId,
  };
}

async function cleanupMirror(
  sessionUserId: string,
  proposal: ValidatedProposal,
  info: { connectionId: string },
) {
  if (proposal.action === "delete_event") {
    await prisma.calendarEventMirror.deleteMany({
      where: { id: proposal.payload.eventId, ownerUserId: sessionUserId },
    });
    return;
  }
  if (proposal.action === "reschedule_event") {
    await prisma.calendarEventMirror.updateMany({
      where: {
        ownerUserId: sessionUserId,
        connectionId: info.connectionId,
        externalEventId: proposal.payload.externalEventId,
      },
      data: {
        title: proposal.payload.title,
        startsAt: new Date(proposal.payload.startsAt),
        endsAt: new Date(proposal.payload.endsAt),
        allDay: proposal.payload.allDay === true,
      },
    });
  }
}

function sendApproval(reply: FastifyReply, result: ApprovalResponse) {
  if (result.ok) {
    return reply.code(result.httpStatus).send({
      ok: true,
      id: result.id,
      status: result.status,
      action: result.action,
      provider: result.provider,
      replayed: result.replayed,
      externalId: result.externalId,
      htmlLink: result.htmlLink,
      expiresAt: result.expiresAt,
    });
  }
  return reply.code(result.httpStatus).send({
    ok: false,
    error: result.error,
    code: result.code,
    ...(result.replayed ? { replayed: true } : {}),
    ...(result.missingScopes ? { missingScopes: result.missingScopes } : {}),
  });
}

function logApproval(
  request: FastifyRequest,
  result: ApprovalResponse,
) {
  request.log.info(
    {
      integrationWrite: true,
      approval: true,
      approvalId: result.ok ? result.id : result.id ?? null,
      action: result.ok ? result.action : null,
      provider: result.ok ? result.provider : null,
      status: result.httpStatus,
      code: result.ok ? null : result.code,
      externalId: result.ok ? result.externalId : null,
      replayed: result.ok ? result.replayed : result.replayed === true,
    },
    "mail calendar approval",
  );
}

/**
 * Propose stores a hash only. Approve is the only path that calls Gmail,
 * Outlook, Google Calendar, or Microsoft Graph, and it does that once per row.
 */
export async function mailCalendarApprovalRoutes(app: FastifyInstance) {
  app.post(
    "/integrations/writes/proposals",
    { bodyLimit: emailWriteBodyLimit },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      reply.header("Cache-Control", "no-store");
      const gate = await gateWriteForSession({
        session,
        ownerUserId: session.sub,
        status: "CONNECTED",
        grantedScopes: [],
        requiredWriteScopes: [],
      });
      if (!gate.ok) {
        const decision = directWriteDecision(gate);
        return reply.code(decision.httpStatus).send({
          error: decision.error,
          code: decision.code,
          missingScopes: decision.missingScopes,
        });
      }
      const result = await proposeMailCalendarWrite({
        ownerUserId: session.sub,
        body: request.body,
        store,
      });
      logApproval(request, result);
      return sendApproval(reply, result);
    },
  );

  app.post(
    "/integrations/writes/proposals/:id/approve",
    { bodyLimit: emailWriteBodyLimit },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      reply.header("Cache-Control", "no-store");
      const approvalId = (request.params as { id?: string }).id ?? "";
      if (!isMirrorId(approvalId)) {
        return reply.code(404).send({ error: "Not found", code: "not_found" });
      }
      const body = request.body as { payload?: unknown } | null;
      const payload =
        typeof body === "object" && body !== null ? body.payload : undefined;
      let audience: Awaited<ReturnType<typeof sessionWriteAudience>>;
      try {
        audience = await sessionWriteAudience(session);
      } catch {
        return reply.code(503).send({
          error: "Integration writes could not be checked. Nothing was sent.",
          code: "writes_unavailable",
        });
      }
      const result = await approveMailCalendarWrite({
        ownerUserId: session.sub,
        actorUserId: session.sub,
        actorLabel: session.username,
        approvalId,
        payload,
        store,
        audit: {
          async record(entry) {
            const meta = auditMetadata(entry.action);
            await tryRecordAccountActivity({
              ownerUserId: entry.ownerUserId,
              actorUserId: entry.actorUserId,
              actorLabel: entry.actorLabel,
              action: meta.activity,
              summary: meta.summary,
              subjectKind: meta.subjectKind,
              subjectId: entry.provider,
            });
          },
        },
        perform: (proposal) =>
          performMailCalendarApproval({
            proposal,
            sessionUserId: session.sub,
            username: audience.username,
            userEmail: audience.userEmail,
            writesEnabled: audience.writesEnabled,
            allowlist: audience.allowlist,
            oauthConfigured: oauthReady(proposal.provider),
            loadConnection: async () => {
              if (
                proposal.action === "send_email" ||
                proposal.action === "save_draft"
              ) {
                return loadMailConnection(session.sub, proposal.provider);
              }
              if (proposal.action === "reschedule_event") {
                return loadCalendarConnection(session.sub, proposal.provider);
              }
              return null;
            },
            loadDeleteTarget: () =>
              proposal.action === "delete_event"
                ? loadDeleteTarget(
                    session.sub,
                    proposal.provider,
                    proposal.payload.eventId,
                  )
                : Promise.resolve(null),
            resolveAccessToken: (connection) => {
              if (
                proposal.provider === "gmail" ||
                proposal.provider === "outlook-mail"
              ) {
                return resolveEmailAccessToken(proposal.provider, connection);
              }
              return resolveCalendarAccessToken(proposal.provider, connection);
            },
            http: providerHttp,
            afterSuccess: (info) => cleanupMirror(session.sub, proposal, info),
          }),
      });
      logApproval(request, result);
      return sendApproval(reply, result);
    },
  );

  app.get("/integrations/writes/proposals/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    const approvalId = (request.params as { id?: string }).id ?? "";
    if (!isMirrorId(approvalId)) {
      return reply.code(404).send({ error: "Not found", code: "not_found" });
    }
    const record = await store.findById(approvalId);
    if (!record || record.ownerUserId !== session.sub) {
      return reply.code(404).send({ error: "Not found", code: "not_found" });
    }
    return {
      id: record.id,
      status: record.status,
      action: record.action,
      provider: record.provider,
      externalId: record.externalId,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
      expiresAt: record.expiresAt,
    };
  });
}

async function loadCalendarConnection(
  ownerUserId: string,
  provider: "google" | "outlook",
) {
  const row = await prisma.integrationConnection.findUnique({
    where: {
      ownerUserId_provider: {
        ownerUserId,
        provider: prismaProvider(provider),
      },
    },
  });
  return row ? asConnection(row) : null;
}

/**
 * Legacy mail/calendar write routes must not call a provider.
 * The flag and allowlist still apply, then the caller is told to approve.
 */
export async function refuseUnapprovedMailCalendarWrite(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = await requireUser(request, reply);
  if (!session) return;
  const gate = await gateWriteForSession({
    session,
    ownerUserId: session.sub,
    status: "CONNECTED",
    grantedScopes: [],
    requiredWriteScopes: [],
  });
  const decision = directWriteDecision(gate);
  return reply.code(decision.httpStatus).send({
    error: decision.error,
    code: decision.code,
    ...(decision.missingScopes ? { missingScopes: decision.missingScopes } : {}),
  });
}

import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import {
  googleCalendarOAuthConfigured,
  githubOAuthConfigured,
  integrationsWriteAllowlist,
  linearOAuthConfigured,
  microsoftCalendarOAuthConfigured,
  slackOAuthConfigured,
} from "../env.js";
import {
  providerFetch,
  resolveCalendarAccessToken,
  resolveCollabAccessToken,
  resolveWorkAccessToken,
} from "../integrations/access-token.js";
import {
  buildCalendarCreateRequest,
  parseCalendarWriteResult,
  validateCalendarEventWritePayload,
} from "../integrations/calendar-write.js";
import { parseCalendarProvider } from "../integrations/calendar-providers.js";
import {
  buildGitHubCommentCreateRequest,
  buildGitHubIssueCreateRequest,
  buildGitHubIssueUpdateRequest,
  buildLinearIssueCreateRequest,
  buildLinearIssueUpdateRequest,
  parseGitHubCommentResult,
  parseGitHubIssueResult,
  parseLinearIssueMutationResult,
  validateGitHubCommentWritePayload,
  validateGitHubIssueUpdatePayload,
  validateGitHubIssueWritePayload,
  validateLinearIssueUpdatePayload,
  validateLinearIssueWritePayload,
} from "../integrations/work-write.js";
import {
  buildSlackMessageCreateRequest,
  parseSlackMessageWriteResult,
  validateSlackMessageWritePayload,
} from "../integrations/collab-write.js";
import { gateWriteForSession, sessionWritesEnabled } from "../integrations/write-audience.js";
import { writeRequiredScopes } from "../integrations/write-scopes.js";
import {
  mailCalendarApprovalRoutes,
  refuseUnapprovedMailCalendarWrite,
} from "./mail-calendar-approval.js";

function opaqueWriteLog(
  request: { log: { info: (obj: object, msg?: string) => void } },
  fields: {
    family: string;
    provider: string;
    connectionId: string;
    status: number;
    externalId?: string | null;
  },
) {
  request.log.info(
    {
      integrationWrite: true,
      family: fields.family,
      provider: fields.provider,
      connectionId: fields.connectionId,
      status: fields.status,
      externalId: fields.externalId ?? null,
    },
    "integration write",
  );
}

/**
 * Phase 4.2 owner-scoped write APIs.
 * Mail and calendar sends, drafts, reschedules, and deletes do not run here.
 * Those require POST /integrations/writes/proposals and then .../approve.
 * Never accept chat ciphertext. Logs opaque ids + status only.
 */
export async function integrationWriteRoutes(app: FastifyInstance) {
  await mailCalendarApprovalRoutes(app);

  app.get("/integrations/writes/status", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    const writesEnabled = await sessionWritesEnabled(session);
    return {
      writesEnabled,
      allowlistActive: integrationsWriteAllowlist.length > 0,
      approvalRequired: [
        "send_email",
        "save_draft",
        "reschedule_event",
        "delete_event",
      ],
      note: writesEnabled
        ? "Mail and calendar changes run only after you approve a proposal. Approving the same proposal twice does not send twice."
        : "Write APIs are off for this account. INTEGRATIONS_WRITE_ENABLED defaults to false, and a dogfood allowlist can limit them to one user.",
      requiredWriteScopes: writeRequiredScopes,
    };
  });

  // —— Calendar create / update ——
  app.post(
    "/integrations/calendar/:provider/events",
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const provider = parseCalendarProvider(
        (request.params as { provider: string }).provider,
      );
      if (!provider) {
        return reply.code(404).send({ error: "Unknown calendar provider" });
      }
      const configured =
        provider === "google"
          ? googleCalendarOAuthConfigured
          : microsoftCalendarOAuthConfigured;
      if (!configured) {
        return reply.code(503).send({ error: "Calendar OAuth is not configured" });
      }

      const parsed = validateCalendarEventWritePayload(request.body);
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }

      const prismaProvider =
        provider === "google" ? "GOOGLE_CALENDAR" : "OUTLOOK_CALENDAR";
      const connection = await prisma.integrationConnection.findUnique({
        where: {
          ownerUserId_provider: {
            ownerUserId: session.sub,
            provider: prismaProvider,
          },
        },
      });
      const gate = await gateWriteForSession({
        session,
        ownerUserId: connection?.ownerUserId,
        status: connection?.status,
        grantedScopes: connection?.scopes ?? [],
        requiredWriteScopes:
          provider === "google"
            ? writeRequiredScopes.googleCalendar
            : writeRequiredScopes.outlookCalendar,
      });
      if (!gate.ok) {
        return reply.code(gate.status).send({
          error: gate.error,
          code: gate.code,
          missingScopes: gate.missingScopes,
        });
      }

      try {
        const accessToken = await resolveCalendarAccessToken(
          provider,
          connection!,
        );
        const req = buildCalendarCreateRequest(provider, parsed.payload);
        const result = await providerFetch(req.url, {
          method: req.method,
          accessToken,
          body: req.body,
        });
        const parsedResult = parseCalendarWriteResult(provider, result.json);
        opaqueWriteLog(request, {
          family: "calendar",
          provider,
          connectionId: connection!.id,
          status: result.status,
          externalId: parsedResult?.externalEventId,
        });
        if (!result.ok || !parsedResult) {
          return reply.code(502).send({
            error: "Calendar create failed",
            code: `calendar_write_${result.status}`,
          });
        }
        return {
          ok: true,
          externalEventId: parsedResult.externalEventId,
          htmlLink: parsedResult.htmlLink,
        };
      } catch (error) {
        const code =
          error instanceof Error ? error.message.slice(0, 64) : "write_failed";
        return reply.code(502).send({ error: "Calendar create failed", code });
      }
    },
  );

  app.patch(
    "/integrations/calendar/:provider/events/:externalEventId",
    async (request, reply) =>
      refuseUnapprovedMailCalendarWrite(request, reply),
  );

  app.delete(
    "/integrations/calendar/:provider/events/:eventId",
    async (request, reply) =>
      refuseUnapprovedMailCalendarWrite(request, reply),
  );

  app.post(
    "/integrations/email/:provider/drafts",
    async (request, reply) =>
      refuseUnapprovedMailCalendarWrite(request, reply),
  );

  app.post(
    "/integrations/email/:provider/send",
    async (request, reply) =>
      refuseUnapprovedMailCalendarWrite(request, reply),
  );


  // —— GitHub issue / update / PR-or-issue comment ——
  app.post("/integrations/work/github/issues", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!githubOAuthConfigured) {
      return reply.code(503).send({ error: "GitHub OAuth is not configured" });
    }

    const parsed = validateGitHubIssueWritePayload(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }

    const connection = await prisma.integrationConnection.findUnique({
      where: {
        ownerUserId_provider: {
          ownerUserId: session.sub,
          provider: "GITHUB",
        },
      },
    });
    const gate = await gateWriteForSession({
      session,
      ownerUserId: connection?.ownerUserId,
      status: connection?.status,
      grantedScopes: connection?.scopes ?? [],
      requiredWriteScopes: writeRequiredScopes.github,
    });
    if (!gate.ok) {
      return reply.code(gate.status).send({
        error: gate.error,
        code: gate.code,
        missingScopes: gate.missingScopes,
      });
    }

    try {
      const accessToken = await resolveWorkAccessToken("github", connection!);
      const req = buildGitHubIssueCreateRequest(parsed.payload);
      const result = await providerFetch(req.url, {
        method: req.method,
        accessToken,
        body: req.body,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "project-2vs-integrations",
        },
      });
      const parsedResult = parseGitHubIssueResult(result.json);
      opaqueWriteLog(request, {
        family: "work",
        provider: "github",
        connectionId: connection!.id,
        status: result.status,
        externalId: parsedResult?.id,
      });
      if (!result.ok || !parsedResult) {
        return reply.code(502).send({
          error: "GitHub issue create failed",
          code: `github_write_${result.status}`,
        });
      }
      return {
        ok: true,
        number: parsedResult.number,
        url: parsedResult.url,
        id: parsedResult.id,
      };
    } catch (error) {
      const code =
        error instanceof Error ? error.message.slice(0, 64) : "write_failed";
      return reply.code(502).send({ error: "GitHub issue create failed", code });
    }
  });

  app.patch("/integrations/work/github/issues", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!githubOAuthConfigured) {
      return reply.code(503).send({ error: "GitHub OAuth is not configured" });
    }

    const parsed = validateGitHubIssueUpdatePayload(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }

    const connection = await prisma.integrationConnection.findUnique({
      where: {
        ownerUserId_provider: {
          ownerUserId: session.sub,
          provider: "GITHUB",
        },
      },
    });
    const gate = await gateWriteForSession({
      session,
      ownerUserId: connection?.ownerUserId,
      status: connection?.status,
      grantedScopes: connection?.scopes ?? [],
      requiredWriteScopes: writeRequiredScopes.github,
    });
    if (!gate.ok) {
      return reply.code(gate.status).send({
        error: gate.error,
        code: gate.code,
        missingScopes: gate.missingScopes,
      });
    }

    try {
      const accessToken = await resolveWorkAccessToken("github", connection!);
      const req = buildGitHubIssueUpdateRequest(parsed.payload);
      const result = await providerFetch(req.url, {
        method: req.method,
        accessToken,
        body: req.body,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "project-2vs-integrations",
        },
      });
      const parsedResult = parseGitHubIssueResult(result.json);
      opaqueWriteLog(request, {
        family: "work",
        provider: "github",
        connectionId: connection!.id,
        status: result.status,
        externalId: parsedResult?.id,
      });
      if (!result.ok || !parsedResult) {
        return reply.code(502).send({
          error: "GitHub issue update failed",
          code: `github_write_${result.status}`,
        });
      }
      return {
        ok: true,
        number: parsedResult.number,
        url: parsedResult.url,
        id: parsedResult.id,
      };
    } catch (error) {
      const code =
        error instanceof Error ? error.message.slice(0, 64) : "write_failed";
      return reply.code(502).send({ error: "GitHub issue update failed", code });
    }
  });

  app.post(
    "/integrations/work/github/comments",
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      if (!githubOAuthConfigured) {
        return reply.code(503).send({ error: "GitHub OAuth is not configured" });
      }

      const parsed = validateGitHubCommentWritePayload(request.body);
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }

      const connection = await prisma.integrationConnection.findUnique({
        where: {
          ownerUserId_provider: {
            ownerUserId: session.sub,
            provider: "GITHUB",
          },
        },
      });
      const gate = await gateWriteForSession({
        session,
        ownerUserId: connection?.ownerUserId,
        status: connection?.status,
        grantedScopes: connection?.scopes ?? [],
        requiredWriteScopes: writeRequiredScopes.github,
      });
      if (!gate.ok) {
        return reply.code(gate.status).send({
          error: gate.error,
          code: gate.code,
          missingScopes: gate.missingScopes,
        });
      }

      try {
        const accessToken = await resolveWorkAccessToken("github", connection!);
        const req = buildGitHubCommentCreateRequest(parsed.payload);
        const result = await providerFetch(req.url, {
          method: req.method,
          accessToken,
          body: req.body,
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "project-2vs-integrations",
          },
        });
        const parsedResult = parseGitHubCommentResult(result.json);
        opaqueWriteLog(request, {
          family: "work",
          provider: "github",
          connectionId: connection!.id,
          status: result.status,
          externalId: parsedResult?.id,
        });
        if (!result.ok || !parsedResult) {
          return reply.code(502).send({
            error: "GitHub comment create failed",
            code: `github_write_${result.status}`,
          });
        }
        return { ok: true, id: parsedResult.id, url: parsedResult.url };
      } catch (error) {
        const code =
          error instanceof Error ? error.message.slice(0, 64) : "write_failed";
        return reply
          .code(502)
          .send({ error: "GitHub comment create failed", code });
      }
    },
  );

  // —— Linear issue create / update ——
  app.post("/integrations/work/linear/issues", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!linearOAuthConfigured) {
      return reply.code(503).send({ error: "Linear OAuth is not configured" });
    }

    const parsed = validateLinearIssueWritePayload(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }

    const connection = await prisma.integrationConnection.findUnique({
      where: {
        ownerUserId_provider: {
          ownerUserId: session.sub,
          provider: "LINEAR",
        },
      },
    });
    const gate = await gateWriteForSession({
      session,
      ownerUserId: connection?.ownerUserId,
      status: connection?.status,
      grantedScopes: connection?.scopes ?? [],
      requiredWriteScopes: writeRequiredScopes.linear,
    });
    if (!gate.ok) {
      return reply.code(gate.status).send({
        error: gate.error,
        code: gate.code,
        missingScopes: gate.missingScopes,
      });
    }

    try {
      const accessToken = await resolveWorkAccessToken("linear", connection!);
      const req = buildLinearIssueCreateRequest(parsed.payload);
      const result = await providerFetch(req.url, {
        method: req.method,
        accessToken,
        body: req.body,
      });
      const parsedResult = parseLinearIssueMutationResult(result.json);
      opaqueWriteLog(request, {
        family: "work",
        provider: "linear",
        connectionId: connection!.id,
        status: result.status,
        externalId: parsedResult?.id,
      });
      if (!result.ok || !parsedResult) {
        return reply.code(502).send({
          error: "Linear issue create failed",
          code: `linear_write_${result.status}`,
        });
      }
      return {
        ok: true,
        id: parsedResult.id,
        identifier: parsedResult.identifier,
        url: parsedResult.url,
      };
    } catch (error) {
      const code =
        error instanceof Error ? error.message.slice(0, 64) : "write_failed";
      return reply.code(502).send({ error: "Linear issue create failed", code });
    }
  });

  app.patch("/integrations/work/linear/issues", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    if (!linearOAuthConfigured) {
      return reply.code(503).send({ error: "Linear OAuth is not configured" });
    }

    const parsed = validateLinearIssueUpdatePayload(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }

    const connection = await prisma.integrationConnection.findUnique({
      where: {
        ownerUserId_provider: {
          ownerUserId: session.sub,
          provider: "LINEAR",
        },
      },
    });
    const gate = await gateWriteForSession({
      session,
      ownerUserId: connection?.ownerUserId,
      status: connection?.status,
      grantedScopes: connection?.scopes ?? [],
      requiredWriteScopes: writeRequiredScopes.linear,
    });
    if (!gate.ok) {
      return reply.code(gate.status).send({
        error: gate.error,
        code: gate.code,
        missingScopes: gate.missingScopes,
      });
    }

    try {
      const accessToken = await resolveWorkAccessToken("linear", connection!);
      const req = buildLinearIssueUpdateRequest(parsed.payload);
      const result = await providerFetch(req.url, {
        method: req.method,
        accessToken,
        body: req.body,
      });
      const parsedResult = parseLinearIssueMutationResult(result.json);
      opaqueWriteLog(request, {
        family: "work",
        provider: "linear",
        connectionId: connection!.id,
        status: result.status,
        externalId: parsedResult?.id,
      });
      if (!result.ok || !parsedResult) {
        return reply.code(502).send({
          error: "Linear issue update failed",
          code: `linear_write_${result.status}`,
        });
      }
      return {
        ok: true,
        id: parsedResult.id,
        identifier: parsedResult.identifier,
        url: parsedResult.url,
      };
    } catch (error) {
      const code =
        error instanceof Error ? error.message.slice(0, 64) : "write_failed";
      return reply.code(502).send({ error: "Linear issue update failed", code });
    }
  });

  // —— Slack post to chosen channel ——
  app.post(
    "/integrations/collab/slack/messages",
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      if (!slackOAuthConfigured) {
        return reply.code(503).send({ error: "Slack OAuth is not configured" });
      }

      const parsed = validateSlackMessageWritePayload(request.body);
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }

      const connection = await prisma.integrationConnection.findUnique({
        where: {
          ownerUserId_provider: {
            ownerUserId: session.sub,
            provider: "SLACK",
          },
        },
      });
      const gate = await gateWriteForSession({
        session,
        ownerUserId: connection?.ownerUserId,
        status: connection?.status,
        grantedScopes: connection?.scopes ?? [],
        requiredWriteScopes: writeRequiredScopes.slack,
      });
      if (!gate.ok) {
        return reply.code(gate.status).send({
          error: gate.error,
          code: gate.code,
          missingScopes: gate.missingScopes,
        });
      }

      try {
        const accessToken = await resolveCollabAccessToken("slack", connection!);
        const req = buildSlackMessageCreateRequest(parsed.payload);
        const result = await providerFetch(req.url, {
          method: req.method,
          accessToken,
          body: req.body,
        });
        const parsedResult = parseSlackMessageWriteResult(result.json);
        opaqueWriteLog(request, {
          family: "collab",
          provider: "slack",
          connectionId: connection!.id,
          status: result.status,
          externalId: parsedResult?.ts,
        });
        if (!result.ok || !parsedResult) {
          return reply.code(502).send({
            error: "Slack message post failed",
            code: `slack_write_${result.status}`,
          });
        }
        return {
          ok: true,
          channelId: parsedResult.channelId,
          ts: parsedResult.ts,
        };
      } catch (error) {
        const code =
          error instanceof Error ? error.message.slice(0, 64) : "write_failed";
        return reply
          .code(502)
          .send({ error: "Slack message post failed", code });
      }
    },
  );
}

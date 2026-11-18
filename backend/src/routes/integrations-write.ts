import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import {
  googleCalendarOAuthConfigured,
  gmailOAuthConfigured,
  githubOAuthConfigured,
  integrationsWriteEnabled,
  linearOAuthConfigured,
  microsoftCalendarOAuthConfigured,
  microsoftMailOAuthConfigured,
  slackOAuthConfigured,
} from "../env.js";
import {
  providerFetch,
  resolveCalendarAccessToken,
  resolveCollabAccessToken,
  resolveEmailAccessToken,
  resolveWorkAccessToken,
} from "../integrations/access-token.js";
import {
  buildCalendarCreateRequest,
  buildCalendarUpdateRequest,
  parseCalendarWriteResult,
  validateCalendarEventWritePayload,
} from "../integrations/calendar-write.js";
import { parseCalendarProvider } from "../integrations/calendar-providers.js";
import {
  buildEmailDraftCreateRequest,
  buildEmailSendRequest,
  emailWriteBodyLimit,
  parseEmailDraftWriteResult,
  parseEmailSendResult,
  validateEmailDraftWritePayload,
} from "../integrations/email-write.js";
import { parseEmailProvider } from "../integrations/email-providers.js";
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
import { gateIntegrationWrite } from "../integrations/write-gate.js";
import { writeRequiredScopes } from "../integrations/write-scopes.js";

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
 * Accept already-approved structured payloads only (agent propose loop is P4.3).
 * Never accept chat ciphertext. Logs opaque ids + status only.
 */
export async function integrationWriteRoutes(app: FastifyInstance) {
  app.get("/integrations/writes/status", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    return {
      writesEnabled: integrationsWriteEnabled,
      note: integrationsWriteEnabled
        ? "Write APIs accept user-approved structured payloads only. No silent sends."
        : "Write APIs are feature-flagged off (INTEGRATIONS_WRITE_ENABLED). Reconnect after upgrading provider consoles, then enable the flag.",
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
      const gate = gateIntegrationWrite({
        ownerUserId: connection?.ownerUserId,
        sessionUserId: session.sub,
        writesEnabled: integrationsWriteEnabled,
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
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const params = request.params as {
        provider: string;
        externalEventId: string;
      };
      const provider = parseCalendarProvider(params.provider);
      if (!provider) {
        return reply.code(404).send({ error: "Unknown calendar provider" });
      }
      if (!params.externalEventId || params.externalEventId.length > 200) {
        return reply.code(400).send({ error: "Invalid externalEventId" });
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
      const gate = gateIntegrationWrite({
        ownerUserId: connection?.ownerUserId,
        sessionUserId: session.sub,
        writesEnabled: integrationsWriteEnabled,
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
        const req = buildCalendarUpdateRequest(
          provider,
          params.externalEventId,
          parsed.payload,
        );
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
          externalId: parsedResult?.externalEventId ?? params.externalEventId,
        });
        if (!result.ok || !parsedResult) {
          return reply.code(502).send({
            error: "Calendar update failed",
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
        return reply.code(502).send({ error: "Calendar update failed", code });
      }
    },
  );

  // —— Email draft (prefer draft; no silent send) ——
  app.post(
    "/integrations/email/:provider/drafts",
    { bodyLimit: emailWriteBodyLimit },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const provider = parseEmailProvider(
        (request.params as { provider: string }).provider,
      );
      if (!provider) {
        return reply.code(404).send({ error: "Unknown email provider" });
      }
      const configured =
        provider === "gmail" ? gmailOAuthConfigured : microsoftMailOAuthConfigured;
      if (!configured) {
        return reply.code(503).send({ error: "Email OAuth is not configured" });
      }

      const parsed = validateEmailDraftWritePayload(request.body);
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }

      const prismaProvider = provider === "gmail" ? "GMAIL" : "OUTLOOK_MAIL";
      const connection = await prisma.integrationConnection.findUnique({
        where: {
          ownerUserId_provider: {
            ownerUserId: session.sub,
            provider: prismaProvider,
          },
        },
      });
      const gate = gateIntegrationWrite({
        ownerUserId: connection?.ownerUserId,
        sessionUserId: session.sub,
        writesEnabled: integrationsWriteEnabled,
        status: connection?.status,
        grantedScopes: connection?.scopes ?? [],
        requiredWriteScopes:
          provider === "gmail"
            ? writeRequiredScopes.gmail
            : writeRequiredScopes.outlookMail,
      });
      if (!gate.ok) {
        return reply.code(gate.status).send({
          error: gate.error,
          code: gate.code,
          missingScopes: gate.missingScopes,
        });
      }

      try {
        const accessToken = await resolveEmailAccessToken(provider, connection!);
        const req = buildEmailDraftCreateRequest(provider, parsed.payload);
        const result = await providerFetch(req.url, {
          method: req.method,
          accessToken,
          body: req.body,
        });
        const parsedResult = parseEmailDraftWriteResult(provider, result.json);
        opaqueWriteLog(request, {
          family: "email",
          provider,
          connectionId: connection!.id,
          status: result.status,
          externalId: parsedResult?.externalDraftId,
        });
        if (!result.ok || !parsedResult) {
          return reply.code(502).send({
            error: "Email draft create failed",
            code: `email_write_${result.status}`,
          });
        }
        return { ok: true, externalDraftId: parsedResult.externalDraftId };
      } catch (error) {
        const code =
          error instanceof Error ? error.message.slice(0, 64) : "write_failed";
        return reply
          .code(502)
          .send({ error: "Email draft create failed", code });
      }
    },
  );

  // Approved send. Still requires the propose→approve payload; nothing here sends silently.
  app.post(
    "/integrations/email/:provider/send",
    { bodyLimit: emailWriteBodyLimit },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const provider = parseEmailProvider(
        (request.params as { provider: string }).provider,
      );
      if (!provider) {
        return reply.code(404).send({ error: "Unknown email provider" });
      }
      const configured =
        provider === "gmail" ? gmailOAuthConfigured : microsoftMailOAuthConfigured;
      if (!configured) {
        return reply.code(503).send({ error: "Email OAuth is not configured" });
      }

      const parsed = validateEmailDraftWritePayload(request.body);
      if (!parsed.ok) {
        return reply.code(400).send({ error: parsed.error });
      }

      const prismaProvider = provider === "gmail" ? "GMAIL" : "OUTLOOK_MAIL";
      const connection = await prisma.integrationConnection.findUnique({
        where: {
          ownerUserId_provider: {
            ownerUserId: session.sub,
            provider: prismaProvider,
          },
        },
      });
      const gate = gateIntegrationWrite({
        ownerUserId: connection?.ownerUserId,
        sessionUserId: session.sub,
        writesEnabled: integrationsWriteEnabled,
        status: connection?.status,
        grantedScopes: connection?.scopes ?? [],
        requiredWriteScopes:
          provider === "gmail"
            ? writeRequiredScopes.gmail
            : writeRequiredScopes.outlookMail,
      });
      if (!gate.ok) {
        return reply.code(gate.status).send({
          error: gate.error,
          code: gate.code,
          missingScopes: gate.missingScopes,
        });
      }

      try {
        const accessToken = await resolveEmailAccessToken(provider, connection!);
        const req = buildEmailSendRequest(provider, parsed.payload);
        const result = await providerFetch(req.url, {
          method: req.method,
          accessToken,
          body: req.body,
        });
        const parsedResult = parseEmailSendResult(
          provider,
          result.json,
          result.status,
        );
        opaqueWriteLog(request, {
          family: "email",
          provider,
          connectionId: connection!.id,
          status: result.status,
          externalId: parsedResult?.externalMessageId ?? undefined,
        });
        if (!result.ok || !parsedResult) {
          return reply.code(502).send({
            error: "Email send failed",
            code: `email_send_${result.status}`,
          });
        }
        return {
          ok: true,
          externalMessageId: parsedResult.externalMessageId,
        };
      } catch (error) {
        const code =
          error instanceof Error ? error.message.slice(0, 64) : "write_failed";
        return reply.code(502).send({ error: "Email send failed", code });
      }
    },
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
    const gate = gateIntegrationWrite({
      ownerUserId: connection?.ownerUserId,
      sessionUserId: session.sub,
      writesEnabled: integrationsWriteEnabled,
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
    const gate = gateIntegrationWrite({
      ownerUserId: connection?.ownerUserId,
      sessionUserId: session.sub,
      writesEnabled: integrationsWriteEnabled,
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
      const gate = gateIntegrationWrite({
        ownerUserId: connection?.ownerUserId,
        sessionUserId: session.sub,
        writesEnabled: integrationsWriteEnabled,
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
    const gate = gateIntegrationWrite({
      ownerUserId: connection?.ownerUserId,
      sessionUserId: session.sub,
      writesEnabled: integrationsWriteEnabled,
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
    const gate = gateIntegrationWrite({
      ownerUserId: connection?.ownerUserId,
      sessionUserId: session.sub,
      writesEnabled: integrationsWriteEnabled,
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
      const gate = gateIntegrationWrite({
        ownerUserId: connection?.ownerUserId,
        sessionUserId: session.sub,
        writesEnabled: integrationsWriteEnabled,
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

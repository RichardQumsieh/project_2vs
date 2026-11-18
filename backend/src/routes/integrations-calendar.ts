import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import {
  env,
  googleCalendarOAuthConfigured,
  integrationsWriteEnabled,
  microsoftCalendarOAuthConfigured,
} from "../env.js";
import {
  providerRead,
  resolveCalendarAccessToken,
} from "../integrations/access-token.js";
import {
  googleEventDetailUrl,
  outlookEventDetailUrl,
  parseGoogleCalendarEvent,
  parseOutlookCalendarEvent,
} from "../integrations/calendar-read.js";
import {
  calendarProviders,
  parseCalendarProvider,
  type CalendarProviderId,
} from "../integrations/calendar-providers.js";
import {
  eventsUrlForProvider,
  normalizeEventsForProvider,
} from "../integrations/calendar-sync.js";
import {
  gateIntegrationRead,
  integrationReadLog,
  isMirrorId,
  readRequiredScopes,
} from "../integrations/read-gate.js";
import { createOAuthState, parseOAuthState } from "../integrations/oauth-state.js";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "../integrations/token-crypto.js";
import { writeRequiredScopes } from "../integrations/write-scopes.js";
import { denyUnlessOwner } from "../task-authorization.js";

function providerConfigured(provider: CalendarProviderId) {
  return provider === "google"
    ? googleCalendarOAuthConfigured
    : microsoftCalendarOAuthConfigured;
}

function clientCredentials(provider: CalendarProviderId) {
  if (provider === "google") {
    return {
      clientId: env.GOOGLE_CALENDAR_CLIENT_ID!,
      clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
    };
  }
  return {
    clientId: env.MICROSOFT_CALENDAR_CLIENT_ID!,
    clientSecret: env.MICROSOFT_CALENDAR_CLIENT_SECRET!,
  };
}

function callbackUrl(provider: CalendarProviderId) {
  const origin = env.API_PUBLIC_ORIGIN!.replace(/\/$/, "");
  return `${origin}/integrations/calendar/${provider}/callback`;
}

function frontendIntegrationsUrl(query: Record<string, string>) {
  const url = new URL("/settings/integrations", env.FRONTEND_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function serializeConnection(connection: {
  id: string;
  provider:
    | "GOOGLE_CALENDAR"
    | "OUTLOOK_CALENDAR"
    | "GMAIL"
    | "OUTLOOK_MAIL"
    | "GITHUB"
    | "LINEAR"
    | "SLACK";
  accountEmail: string | null;
  scopes: string[];
  status: "CONNECTED" | "REVOKED" | "ERROR";
  lastSyncAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: connection.id,
    provider: connection.provider,
    accountEmail: connection.accountEmail,
    scopes: connection.scopes,
    status: connection.status,
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

async function exchangeAuthorizationCode(input: {
  provider: CalendarProviderId;
  code: string;
}) {
  const config = calendarProviders[input.provider];
  const credentials = clientCredentials(input.provider);
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code: input.code,
    redirect_uri: callbackUrl(input.provider),
    grant_type: "authorization_code",
  });
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`token_exchange_${response.status}`);
  }
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) {
    throw new Error("token_exchange_invalid");
  }
  const row = result as Record<string, unknown>;
  if (typeof row.refresh_token !== "string" || !row.refresh_token) {
    // Google may omit refresh_token on re-consent without prompt=consent + access_type=offline.
    throw new Error("token_exchange_missing_refresh");
  }
  const accessToken =
    typeof row.access_token === "string" ? row.access_token : null;
  const expiresIn =
    typeof row.expires_in === "number" && Number.isFinite(row.expires_in)
      ? row.expires_in
      : 3600;
  const scope =
    typeof row.scope === "string"
      ? row.scope.split(/\s+/).filter(Boolean)
      : config.scopes;
  return {
    refreshToken: row.refresh_token,
    accessToken,
    accessTokenExpiresAt: accessToken
      ? new Date(Date.now() + expiresIn * 1000)
      : null,
    scopes: scope.slice(0, 20),
  };
}

async function refreshAccessToken(input: {
  provider: CalendarProviderId;
  refreshToken: string;
}) {
  const config = calendarProviders[input.provider];
  const credentials = clientCredentials(input.provider);
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`token_refresh_${response.status}`);
  }
  const result: unknown = await response.json();
  if (
    typeof result !== "object" ||
    result === null ||
    typeof (result as { access_token?: unknown }).access_token !== "string"
  ) {
    throw new Error("token_refresh_invalid");
  }
  const row = result as { access_token: string; expires_in?: number };
  const expiresIn =
    typeof row.expires_in === "number" && Number.isFinite(row.expires_in)
      ? row.expires_in
      : 3600;
  return {
    accessToken: row.access_token,
    accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
  };
}

async function fetchAccountEmail(
  provider: CalendarProviderId,
  accessToken: string,
) {
  try {
    if (provider === "google") {
      const response = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        return null;
      }
      const result: unknown = await response.json();
      return typeof result === "object" &&
        result !== null &&
        typeof (result as { email?: unknown }).email === "string"
        ? (result as { email: string }).email.slice(0, 320)
        : null;
    }
    const response = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null) {
      return null;
    }
    const mail =
      typeof (result as { mail?: unknown }).mail === "string"
        ? (result as { mail: string }).mail
        : typeof (result as { userPrincipalName?: unknown }).userPrincipalName ===
            "string"
          ? (result as { userPrincipalName: string }).userPrincipalName
          : null;
    return mail?.slice(0, 320) ?? null;
  } catch {
    return null;
  }
}

export async function integrationCalendarRoutes(app: FastifyInstance) {
  app.get("/integrations/calendar/status", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    reply.header("Cache-Control", "no-store");
    return {
      providers: {
        google: {
          configured: googleCalendarOAuthConfigured,
          scopes: calendarProviders.google.scopes,
          requiredWriteScopes: [...writeRequiredScopes.googleCalendar],
        },
        outlook: {
          configured: microsoftCalendarOAuthConfigured,
          scopes: calendarProviders.outlook.scopes,
          requiredWriteScopes: [...writeRequiredScopes.outlookCalendar],
        },
      },
      writesEnabled: integrationsWriteEnabled,
      privacy: {
        storesChatPlaintext: false,
        aiUsesCalendarBodiesByDefault: false,
        note:
          "Calendar mirrors stay owner-scoped (title and time). Opening an event fetches location, attendees, and description with your token and does not store them. Sophia/AI will not read event bodies without a separate explicit consent. Deletes use calendar.events and Calendars.ReadWrite, which already cover removal. Writes require INTEGRATIONS_WRITE_ENABLED.",
      },
    };
  });

  app.get("/integrations/calendar/connections", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const connections = await prisma.integrationConnection.findMany({
      where: {
        ownerUserId: session.sub,
        provider: { in: ["GOOGLE_CALENDAR", "OUTLOOK_CALENDAR"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    reply.header("Cache-Control", "no-store");
    return { connections: connections.map(serializeConnection) };
  });

  app.get(
    "/integrations/calendar/:provider/authorize",
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const provider = parseCalendarProvider(
        (request.params as { provider: string }).provider,
      );
      if (!provider) {
        return reply.code(404).send({ error: "Unknown calendar provider" });
      }
      if (!providerConfigured(provider)) {
        return reply.code(503).send({
          error: "Calendar OAuth is not configured on this server",
          missingEnv:
            provider === "google"
              ? [
                  "GOOGLE_CALENDAR_CLIENT_ID",
                  "GOOGLE_CALENDAR_CLIENT_SECRET",
                  "API_PUBLIC_ORIGIN",
                ]
              : [
                  "MICROSOFT_CALENDAR_CLIENT_ID",
                  "MICROSOFT_CALENDAR_CLIENT_SECRET",
                  "API_PUBLIC_ORIGIN",
                ],
        });
      }

      const config = calendarProviders[provider];
      const credentials = clientCredentials(provider);
      const state = createOAuthState(
        {
          userId: session.sub,
          provider,
          nonce: randomBytes(16).toString("base64url"),
        },
        env.JWT_SECRET,
      );
      const url = new URL(config.authorizeUrl);
      url.searchParams.set("client_id", credentials.clientId);
      url.searchParams.set("redirect_uri", callbackUrl(provider));
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", config.scopes.join(" "));
      url.searchParams.set("state", state);
      if (provider === "google") {
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");
        url.searchParams.set("include_granted_scopes", "false");
      } else {
        url.searchParams.set("response_mode", "query");
      }

      return { url: url.toString(), scopes: config.scopes };
    },
  );

  app.get(
    "/integrations/calendar/:provider/callback",
    async (request, reply) => {
      const provider = parseCalendarProvider(
        (request.params as { provider: string }).provider,
      );
      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (!provider) {
        return reply.redirect(
          frontendIntegrationsUrl({ calendar: "error", reason: "unknown_provider" }),
        );
      }
      if (query.error) {
        return reply.redirect(
          frontendIntegrationsUrl({
            calendar: "error",
            provider,
            reason: "provider_denied",
          }),
        );
      }
      if (!providerConfigured(provider) || !query.code || !query.state) {
        return reply.redirect(
          frontendIntegrationsUrl({
            calendar: "error",
            provider,
            reason: "invalid_callback",
          }),
        );
      }

      const state = parseOAuthState(query.state, env.JWT_SECRET);
      if (!state || state.provider !== provider) {
        return reply.redirect(
          frontendIntegrationsUrl({
            calendar: "error",
            provider,
            reason: "invalid_state",
          }),
        );
      }

      try {
        const tokens = await exchangeAuthorizationCode({
          provider,
          code: query.code,
        });
        const accountEmail = tokens.accessToken
          ? await fetchAccountEmail(provider, tokens.accessToken)
          : null;
        const prismaProvider = calendarProviders[provider].prismaProvider;

        await prisma.integrationConnection.upsert({
          where: {
            ownerUserId_provider: {
              ownerUserId: state.userId,
              provider: prismaProvider,
            },
          },
          create: {
            ownerUserId: state.userId,
            provider: prismaProvider,
            accountEmail,
            scopes: tokens.scopes,
            refreshTokenEncrypted: encryptIntegrationSecret(tokens.refreshToken),
            accessTokenEncrypted: tokens.accessToken
              ? encryptIntegrationSecret(tokens.accessToken)
              : null,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            status: "CONNECTED",
            lastErrorCode: null,
          },
          update: {
            accountEmail,
            scopes: tokens.scopes,
            refreshTokenEncrypted: encryptIntegrationSecret(tokens.refreshToken),
            accessTokenEncrypted: tokens.accessToken
              ? encryptIntegrationSecret(tokens.accessToken)
              : null,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            status: "CONNECTED",
            lastErrorCode: null,
          },
        });

        return reply.redirect(
          frontendIntegrationsUrl({
            calendar: "connected",
            provider,
          }),
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message.slice(0, 64) : "callback_failed";
        return reply.redirect(
          frontendIntegrationsUrl({
            calendar: "error",
            provider,
            reason,
          }),
        );
      }
    },
  );

  app.delete(
    "/integrations/calendar/:provider",
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const provider = parseCalendarProvider(
        (request.params as { provider: string }).provider,
      );
      if (!provider) {
        return reply.code(404).send({ error: "Unknown calendar provider" });
      }

      const prismaProvider = calendarProviders[provider].prismaProvider;
      const existing = await prisma.integrationConnection.findUnique({
        where: {
          ownerUserId_provider: {
            ownerUserId: session.sub,
            provider: prismaProvider,
          },
        },
      });
      const ownership = denyUnlessOwner({
        ownerUserId: existing?.ownerUserId,
        sessionUserId: session.sub,
      });
      if (!ownership.ok) {
        return reply.code(ownership.status).send({ error: ownership.error });
      }

      const refreshToken = decryptIntegrationSecret(
        existing!.refreshTokenEncrypted,
      );
      const revokeUrl = calendarProviders[provider].revokeUrl;
      if (revokeUrl && providerConfigured(provider)) {
        try {
          await fetch(revokeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: refreshToken }),
            signal: AbortSignal.timeout(10_000),
          });
        } catch {
          // Local revoke still proceeds even if provider revoke is unreachable.
        }
      }

      await prisma.$transaction([
        prisma.calendarEventMirror.deleteMany({
          where: {
            ownerUserId: session.sub,
            connectionId: existing!.id,
          },
        }),
        prisma.integrationConnection.update({
          where: { id: existing!.id },
          data: {
            status: "REVOKED",
            refreshTokenEncrypted: encryptIntegrationSecret("revoked"),
            accessTokenEncrypted: null,
            accessTokenExpiresAt: null,
            lastErrorCode: null,
          },
        }),
      ]);

      return { ok: true };
    },
  );

  app.post(
    "/integrations/calendar/:provider/sync",
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const provider = parseCalendarProvider(
        (request.params as { provider: string }).provider,
      );
      if (!provider) {
        return reply.code(404).send({ error: "Unknown calendar provider" });
      }
      if (!providerConfigured(provider)) {
        return reply.code(503).send({
          error: "Calendar OAuth is not configured on this server",
        });
      }

      const prismaProvider = calendarProviders[provider].prismaProvider;
      const connection = await prisma.integrationConnection.findUnique({
        where: {
          ownerUserId_provider: {
            ownerUserId: session.sub,
            provider: prismaProvider,
          },
        },
      });
      const ownership = denyUnlessOwner({
        ownerUserId: connection?.ownerUserId,
        sessionUserId: session.sub,
      });
      if (!ownership.ok || connection?.status !== "CONNECTED") {
        return reply.code(ownership.ok ? 409 : ownership.status).send({
          error: ownership.ok ? "Calendar is not connected" : ownership.error,
        });
      }

      try {
        let accessToken = connection.accessTokenEncrypted
          ? decryptIntegrationSecret(connection.accessTokenEncrypted)
          : null;
        const expired =
          !connection.accessTokenExpiresAt ||
          connection.accessTokenExpiresAt.getTime() <= Date.now() + 60_000;
        if (!accessToken || expired) {
          const refreshed = await refreshAccessToken({
            provider,
            refreshToken: decryptIntegrationSecret(
              connection.refreshTokenEncrypted,
            ),
          });
          accessToken = refreshed.accessToken;
          await prisma.integrationConnection.update({
            where: { id: connection.id },
            data: {
              accessTokenEncrypted: encryptIntegrationSecret(accessToken),
              accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
              lastErrorCode: null,
            },
          });
        }

        const now = new Date();
        const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const url = eventsUrlForProvider(provider, { timeMin, timeMax });
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(provider === "outlook"
              ? { Prefer: 'outlook.timezone="UTC"' }
              : {}),
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          throw new Error(`calendar_fetch_${response.status}`);
        }
        const payload: unknown = await response.json();
        const events = normalizeEventsForProvider(provider, payload);
        const syncedAt = new Date();

        await prisma.$transaction([
          prisma.calendarEventMirror.deleteMany({
            where: {
              ownerUserId: session.sub,
              connectionId: connection.id,
            },
          }),
          ...events.map((event) =>
            prisma.calendarEventMirror.create({
              data: {
                ownerUserId: session.sub,
                connectionId: connection.id,
                externalEventId: event.externalEventId,
                calendarId: event.calendarId,
                title: event.title,
                startsAt: event.startsAt,
                endsAt: event.endsAt,
                allDay: event.allDay,
                busy: event.busy,
                syncedAt,
              },
            }),
          ),
          prisma.integrationConnection.update({
            where: { id: connection.id },
            data: {
              lastSyncAt: syncedAt,
              lastErrorCode: null,
              status: "CONNECTED",
            },
          }),
        ]);

        return {
          synced: events.length,
          window: {
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
          },
        };
      } catch (error) {
        const code =
          error instanceof Error ? error.message.slice(0, 64) : "sync_failed";
        await prisma.integrationConnection.update({
          where: { id: connection.id },
          data: { status: "ERROR", lastErrorCode: code },
        });
        return reply.code(502).send({ error: "Calendar sync failed", code });
      }
    },
  );

  app.get("/integrations/calendar/events", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const query = request.query as { from?: string; to?: string };
    const from = query.from ? Date.parse(query.from) : Date.now() - 7 * 86400000;
    const to = query.to ? Date.parse(query.to) : Date.now() + 30 * 86400000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      return reply.code(400).send({ error: "Invalid from/to window" });
    }

    const events = await prisma.calendarEventMirror.findMany({
      where: {
        ownerUserId: session.sub,
        startsAt: { lte: new Date(to) },
        endsAt: { gte: new Date(from) },
      },
      orderBy: { startsAt: "asc" },
      take: 250,
      include: {
        connection: { select: { provider: true, accountEmail: true } },
      },
    });

    reply.header("Cache-Control", "no-store");
    return {
      events: events.map((event) => ({
        id: event.id,
        provider: event.connection.provider,
        accountEmail: event.connection.accountEmail,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        allDay: event.allDay,
        busy: event.busy,
        syncedAt: event.syncedAt.toISOString(),
      })),
    };
  });

  // Live detail for the signed-in owner. Description is not written to the mirror or logs.
  app.get("/integrations/calendar/events/:eventId", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const eventId = (request.params as { eventId?: string }).eventId ?? "";
    if (!isMirrorId(eventId)) {
      return reply.code(404).send({ error: "Not found" });
    }

    const event = await prisma.calendarEventMirror.findFirst({
      where: { id: eventId, ownerUserId: session.sub },
      include: { connection: true },
    });
    const provider =
      event?.connection.provider === "GOOGLE_CALENDAR"
        ? "google"
        : event?.connection.provider === "OUTLOOK_CALENDAR"
          ? "outlook"
          : null;
    const gate = gateIntegrationRead({
      ownerUserId: event?.ownerUserId,
      sessionUserId: session.sub,
      status: event?.connection.status,
      grantedScopes: event?.connection.scopes ?? [],
      requiredReadScopes:
        provider === "outlook"
          ? readRequiredScopes.outlookCalendar
          : readRequiredScopes.googleCalendar,
    });
    if (!event || !provider || !gate.ok) {
      const failure = !gate.ok ? gate : null;
      return reply.code(failure && event && provider ? failure.status : 404).send({
        error: failure && event && provider ? failure.error : "Not found",
        ...(failure && event && provider
          ? { code: failure.code, missingScopes: failure.missingScopes }
          : {}),
      });
    }
    if (!providerConfigured(provider)) {
      return reply.code(503).send({ error: "Calendar OAuth is not configured" });
    }

    reply.header("Cache-Control", "no-store");
    try {
      const accessToken = await resolveCalendarAccessToken(provider, event.connection);
      const url =
        provider === "google"
          ? googleEventDetailUrl(event.calendarId, event.externalEventId)
          : outlookEventDetailUrl(event.externalEventId);
      const result = await providerRead(url, accessToken);
      request.log.info(
        integrationReadLog({
          family: "calendar",
          provider,
          connectionId: event.connection.id,
          resourceId: event.id,
          status: result.status,
        }),
        "integration read",
      );
      if (result.tooLarge) {
        return reply.code(502).send({
          error: "This event is too large to open here",
          code: "calendar_read_too_large",
        });
      }
      const parsed = result.ok
        ? provider === "google"
          ? parseGoogleCalendarEvent(result.json)
          : parseOutlookCalendarEvent(result.json)
        : null;
      if (!result.ok || !parsed) {
        return reply.code(502).send({
          error: "Could not read this event",
          code: `calendar_read_${result.status || "invalid"}`,
        });
      }
      return {
        id: event.id,
        provider,
        title: parsed.title || event.title,
        startsAt: parsed.startsAt || event.startsAt.toISOString(),
        endsAt: parsed.endsAt || event.endsAt.toISOString(),
        allDay: parsed.allDay || event.allDay,
        location: parsed.location,
        description: parsed.description,
        attendees: parsed.attendees,
        truncated: parsed.truncated,
      };
    } catch (error) {
      const code =
        error instanceof Error ? error.message.slice(0, 64) : "calendar_read_failed";
      request.log.info(
        integrationReadLog({
          family: "calendar",
          provider,
          connectionId: event.connection.id,
          resourceId: event.id,
          status: 0,
        }),
        "integration read",
      );
      return reply.code(502).send({ error: "Could not read this event", code });
    }
  });
}

import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { env, slackOAuthConfigured } from "../env.js";
import {
  SLACK_CONVERSATIONS_LIST_URL,
  collabProviders,
  parseCollabProvider,
  type CollabProviderId,
} from "../integrations/collab-providers.js";
import { normalizeCollabChannelsForProvider } from "../integrations/collab-sync.js";
import { createOAuthState, parseOAuthState } from "../integrations/oauth-state.js";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "../integrations/token-crypto.js";
import { denyUnlessOwner } from "../task-authorization.js";

function providerConfigured(provider: CollabProviderId) {
  return provider === "slack" ? slackOAuthConfigured : false;
}

function clientCredentials(_provider: CollabProviderId) {
  return {
    clientId: env.SLACK_OAUTH_CLIENT_ID!,
    clientSecret: env.SLACK_OAUTH_CLIENT_SECRET!,
  };
}

function callbackUrl(provider: CollabProviderId) {
  const origin = env.API_PUBLIC_ORIGIN!.replace(/\/$/, "");
  return `${origin}/integrations/collab/${provider}/callback`;
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
  provider: CollabProviderId;
  code: string;
}) {
  const config = collabProviders[input.provider];
  const credentials = clientCredentials(input.provider);
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code: input.code,
      redirect_uri: callbackUrl(input.provider),
    }),
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
  if (row.ok !== true) {
    throw new Error("token_exchange_slack_not_ok");
  }
  // Prefer user token (user_scope install); fall back to bot token if only that is present.
  const authedUser =
    typeof row.authed_user === "object" && row.authed_user !== null
      ? (row.authed_user as Record<string, unknown>)
      : null;
  const userAccess =
    authedUser && typeof authedUser.access_token === "string"
      ? authedUser.access_token
      : null;
  const botAccess =
    typeof row.access_token === "string" ? row.access_token : null;
  const accessToken = userAccess || botAccess;
  if (!accessToken) {
    throw new Error("token_exchange_missing_access");
  }
  const userScope =
    authedUser && typeof authedUser.scope === "string"
      ? authedUser.scope.split(/[,\s]+/).filter(Boolean)
      : [];
  const botScope =
    typeof row.scope === "string"
      ? row.scope.split(/[,\s]+/).filter(Boolean)
      : [];
  const scopes = (userScope.length > 0 ? userScope : botScope).slice(0, 20);
  const team =
    typeof row.team === "object" && row.team !== null
      ? (row.team as { name?: unknown })
      : null;
  const accountLabel =
    typeof team?.name === "string" ? team.name.slice(0, 320) : null;
  return {
    refreshToken: accessToken,
    accessToken,
    accessTokenExpiresAt: null as Date | null,
    scopes: scopes.length > 0 ? scopes : config.scopes,
    accountLabel,
  };
}

async function fetchAccountLabel(accessToken: string) {
  try {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      (result as { ok?: unknown }).ok !== true
    ) {
      return null;
    }
    const user =
      typeof (result as { user?: unknown }).user === "string"
        ? (result as { user: string }).user
        : null;
    const team =
      typeof (result as { team?: unknown }).team === "string"
        ? (result as { team: string }).team
        : null;
    return (user && team ? `${user}@${team}` : user || team)?.slice(0, 320) ?? null;
  } catch {
    return null;
  }
}

async function revokeProviderToken(token: string) {
  if (!slackOAuthConfigured) {
    return;
  }
  await fetch("https://slack.com/api/auth.revoke", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    signal: AbortSignal.timeout(10_000),
  });
}

export async function integrationCollabRoutes(app: FastifyInstance) {
  app.get("/integrations/collab/status", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    reply.header("Cache-Control", "no-store");
    return {
      providers: {
        slack: {
          configured: slackOAuthConfigured,
          scopes: collabProviders.slack.scopes,
        },
      },
      privacy: {
        storesChatPlaintext: false,
        storesMessageHistory: false,
        aiUsesCollabBodiesByDefault: false,
        note:
          "Slack mirrors stay owner-scoped (channel names/ids only). No message history is stored. Sophia/AI will not read Slack content without a separate explicit consent later.",
      },
    };
  });

  app.get("/integrations/collab/connections", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const connections = await prisma.integrationConnection.findMany({
      where: {
        ownerUserId: session.sub,
        provider: { in: ["SLACK"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    reply.header("Cache-Control", "no-store");
    return { connections: connections.map(serializeConnection) };
  });

  app.get(
    "/integrations/collab/:provider/authorize",
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const provider = parseCollabProvider(
        (request.params as { provider: string }).provider,
      );
      if (!provider) {
        return reply.code(404).send({ error: "Unknown collab provider" });
      }
      if (!providerConfigured(provider)) {
        return reply.code(503).send({
          error: "Collab OAuth is not configured on this server",
          missingEnv: [
            "SLACK_OAUTH_CLIENT_ID",
            "SLACK_OAUTH_CLIENT_SECRET",
            "API_PUBLIC_ORIGIN",
          ],
        });
      }

      const config = collabProviders[provider];
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
      url.searchParams.set("state", state);
      // User token scopes only — no bot scopes required for channel listing.
      url.searchParams.set("user_scope", config.scopes.join(","));

      return { url: url.toString(), scopes: config.scopes };
    },
  );

  app.get(
    "/integrations/collab/:provider/callback",
    async (request, reply) => {
      const provider = parseCollabProvider(
        (request.params as { provider: string }).provider,
      );
      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (!provider) {
        return reply.redirect(
          frontendIntegrationsUrl({
            collab: "error",
            reason: "unknown_provider",
          }),
        );
      }
      if (query.error) {
        return reply.redirect(
          frontendIntegrationsUrl({
            collab: "error",
            provider,
            reason: "provider_denied",
          }),
        );
      }
      if (!providerConfigured(provider) || !query.code || !query.state) {
        return reply.redirect(
          frontendIntegrationsUrl({
            collab: "error",
            provider,
            reason: "invalid_callback",
          }),
        );
      }

      const state = parseOAuthState(query.state, env.JWT_SECRET);
      if (!state || state.provider !== provider) {
        return reply.redirect(
          frontendIntegrationsUrl({
            collab: "error",
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
        const accountEmail =
          tokens.accountLabel ||
          (await fetchAccountLabel(tokens.accessToken));
        const prismaProvider = collabProviders[provider].prismaProvider;

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
            accessTokenEncrypted: encryptIntegrationSecret(tokens.accessToken),
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            status: "CONNECTED",
            lastErrorCode: null,
          },
          update: {
            accountEmail,
            scopes: tokens.scopes,
            refreshTokenEncrypted: encryptIntegrationSecret(tokens.refreshToken),
            accessTokenEncrypted: encryptIntegrationSecret(tokens.accessToken),
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            status: "CONNECTED",
            lastErrorCode: null,
          },
        });

        return reply.redirect(
          frontendIntegrationsUrl({
            collab: "connected",
            provider,
          }),
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message.slice(0, 64) : "callback_failed";
        return reply.redirect(
          frontendIntegrationsUrl({
            collab: "error",
            provider,
            reason,
          }),
        );
      }
    },
  );

  app.delete("/integrations/collab/:provider", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const provider = parseCollabProvider(
      (request.params as { provider: string }).provider,
    );
    if (!provider) {
      return reply.code(404).send({ error: "Unknown collab provider" });
    }

    const prismaProvider = collabProviders[provider].prismaProvider;
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

    const storedToken = decryptIntegrationSecret(existing!.refreshTokenEncrypted);
    try {
      await revokeProviderToken(storedToken);
    } catch {
      // Local revoke still proceeds.
    }

    await prisma.$transaction([
      prisma.collabChannelMirror.deleteMany({
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
  });

  app.post("/integrations/collab/:provider/sync", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const provider = parseCollabProvider(
      (request.params as { provider: string }).provider,
    );
    if (!provider) {
      return reply.code(404).send({ error: "Unknown collab provider" });
    }
    if (!providerConfigured(provider)) {
      return reply.code(503).send({
        error: "Collab OAuth is not configured on this server",
      });
    }

    const prismaProvider = collabProviders[provider].prismaProvider;
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
        error: ownership.ok
          ? "Collab provider is not connected"
          : ownership.error,
      });
    }

    try {
      const accessToken = connection.accessTokenEncrypted
        ? decryptIntegrationSecret(connection.accessTokenEncrypted)
        : decryptIntegrationSecret(connection.refreshTokenEncrypted);

      const url = new URL(SLACK_CONVERSATIONS_LIST_URL);
      url.searchParams.set("types", "public_channel,private_channel");
      url.searchParams.set("exclude_archived", "false");
      url.searchParams.set("limit", "200");
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`collab_fetch_${response.status}`);
      }
      const payload: unknown = await response.json();
      if (
        typeof payload !== "object" ||
        payload === null ||
        (payload as { ok?: unknown }).ok !== true
      ) {
        throw new Error("collab_fetch_slack_not_ok");
      }

      const channels = normalizeCollabChannelsForProvider(provider, payload);
      const syncedAt = new Date();

      await prisma.$transaction([
        prisma.collabChannelMirror.deleteMany({
          where: {
            ownerUserId: session.sub,
            connectionId: connection.id,
          },
        }),
        ...channels.map((channel) =>
          prisma.collabChannelMirror.create({
            data: {
              ownerUserId: session.sub,
              connectionId: connection.id,
              externalChannelId: channel.externalChannelId,
              name: channel.name,
              isPrivate: channel.isPrivate,
              isArchived: channel.isArchived,
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

      return { synced: channels.length };
    } catch (error) {
      const code =
        error instanceof Error ? error.message.slice(0, 64) : "sync_failed";
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: { status: "ERROR", lastErrorCode: code },
      });
      return reply.code(502).send({ error: "Collab sync failed", code });
    }
  });

  app.get("/integrations/collab/channels", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const channels = await prisma.collabChannelMirror.findMany({
      where: { ownerUserId: session.sub },
      orderBy: [{ name: "asc" }],
      take: 200,
      include: {
        connection: { select: { provider: true, accountEmail: true } },
      },
    });

    reply.header("Cache-Control", "no-store");
    return {
      channels: channels.map((channel) => ({
        id: channel.id,
        provider: channel.connection.provider,
        accountEmail: channel.connection.accountEmail,
        name: channel.name,
        isPrivate: channel.isPrivate,
        isArchived: channel.isArchived,
        syncedAt: channel.syncedAt.toISOString(),
      })),
    };
  });
}

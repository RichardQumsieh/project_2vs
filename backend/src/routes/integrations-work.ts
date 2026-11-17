import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import {
  env,
  githubOAuthConfigured,
  linearOAuthConfigured,
} from "../env.js";
import {
  GITHUB_ASSIGNED_ISSUES_URL,
  LINEAR_GRAPHQL_URL,
  parseWorkProvider,
  workProviders,
  type WorkProviderId,
} from "../integrations/work-providers.js";
import {
  LINEAR_ASSIGNED_ISSUES_QUERY,
  normalizeWorkItemsForProvider,
} from "../integrations/work-sync.js";
import { createOAuthState, parseOAuthState } from "../integrations/oauth-state.js";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "../integrations/token-crypto.js";
import { denyUnlessOwner } from "../task-authorization.js";

function providerConfigured(provider: WorkProviderId) {
  return provider === "github" ? githubOAuthConfigured : linearOAuthConfigured;
}

function clientCredentials(provider: WorkProviderId) {
  if (provider === "github") {
    return {
      clientId: env.GITHUB_OAUTH_CLIENT_ID!,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET!,
    };
  }
  return {
    clientId: env.LINEAR_OAUTH_CLIENT_ID!,
    clientSecret: env.LINEAR_OAUTH_CLIENT_SECRET!,
  };
}

function callbackUrl(provider: WorkProviderId) {
  const origin = env.API_PUBLIC_ORIGIN!.replace(/\/$/, "");
  return `${origin}/integrations/work/${provider}/callback`;
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
  provider: WorkProviderId;
  code: string;
}) {
  const config = workProviders[input.provider];
  const credentials = clientCredentials(input.provider);
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code: input.code,
    redirect_uri: callbackUrl(input.provider),
    grant_type: "authorization_code",
  });
  if (input.provider === "linear") {
    // Request offline access so Linear returns a refresh_token when enabled.
    body.set("actor", "user");
  }
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
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
  if (typeof row.access_token !== "string" || !row.access_token) {
    throw new Error("token_exchange_missing_access");
  }
  // GitHub classic OAuth tokens are long-lived and omit refresh_token.
  // Linear may omit refresh when offline access is not enabled on the app.
  const refreshToken =
    typeof row.refresh_token === "string" && row.refresh_token
      ? row.refresh_token
      : row.access_token;
  const expiresIn =
    typeof row.expires_in === "number" && Number.isFinite(row.expires_in)
      ? row.expires_in
      : null;
  const scope =
    typeof row.scope === "string"
      ? row.scope.split(/[,\s]+/).filter(Boolean)
      : Array.isArray(row.scope)
        ? (row.scope as unknown[])
            .filter((value): value is string => typeof value === "string")
        : config.scopes;
  return {
    refreshToken,
    accessToken: row.access_token,
    accessTokenExpiresAt: expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null,
    scopes: scope.slice(0, 20),
  };
}

async function refreshAccessToken(input: {
  provider: WorkProviderId;
  refreshToken: string;
}) {
  if (input.provider === "github") {
    // Classic GitHub user tokens do not refresh; the stored token is the access token.
    return {
      accessToken: input.refreshToken,
      accessTokenExpiresAt: null as Date | null,
    };
  }
  const config = workProviders.linear;
  const credentials = clientCredentials("linear");
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Fall back to treating the stored credential as a non-expiring access token.
    if (response.status === 400 || response.status === 401) {
      return {
        accessToken: input.refreshToken,
        accessTokenExpiresAt: null as Date | null,
      };
    }
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
  const row = result as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
  const expiresIn =
    typeof row.expires_in === "number" && Number.isFinite(row.expires_in)
      ? row.expires_in
      : null;
  return {
    accessToken: row.access_token,
    accessTokenExpiresAt: expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null,
    refreshToken:
      typeof row.refresh_token === "string" && row.refresh_token
        ? row.refresh_token
        : undefined,
  };
}

async function fetchAccountLabel(
  provider: WorkProviderId,
  accessToken: string,
) {
  try {
    if (provider === "github") {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "project-2vs-integrations",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return null;
      }
      const result: unknown = await response.json();
      if (typeof result !== "object" || result === null) {
        return null;
      }
      const login =
        typeof (result as { login?: unknown }).login === "string"
          ? (result as { login: string }).login
          : null;
      const email =
        typeof (result as { email?: unknown }).email === "string"
          ? (result as { email: string }).email
          : null;
      return (email || login)?.slice(0, 320) ?? null;
    }
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "query { viewer { id name email } }",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    const result: unknown = await response.json();
    const viewer =
      typeof result === "object" &&
      result !== null &&
      typeof (result as { data?: unknown }).data === "object" &&
      (result as { data: { viewer?: unknown } }).data !== null
        ? (result as { data: { viewer?: Record<string, unknown> } }).data.viewer
        : null;
    if (!viewer) {
      return null;
    }
    const email =
      typeof viewer.email === "string" ? viewer.email : null;
    const name = typeof viewer.name === "string" ? viewer.name : null;
    return (email || name)?.slice(0, 320) ?? null;
  } catch {
    return null;
  }
}

async function revokeProviderToken(input: {
  provider: WorkProviderId;
  token: string;
}) {
  if (input.provider === "github" && githubOAuthConfigured) {
    const credentials = clientCredentials("github");
    const basic = Buffer.from(
      `${credentials.clientId}:${credentials.clientSecret}`,
    ).toString("base64");
    await fetch(
      `https://api.github.com/applications/${credentials.clientId}/token`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${basic}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "project-2vs-integrations",
        },
        body: JSON.stringify({ access_token: input.token }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    return;
  }
  const revokeUrl = workProviders.linear.revokeUrl;
  if (revokeUrl && linearOAuthConfigured) {
    await fetch(revokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: input.token }),
      signal: AbortSignal.timeout(10_000),
    });
  }
}

export async function integrationWorkRoutes(app: FastifyInstance) {
  app.get("/integrations/work/status", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    reply.header("Cache-Control", "no-store");
    return {
      providers: {
        github: {
          configured: githubOAuthConfigured,
          scopes: workProviders.github.scopes,
        },
        linear: {
          configured: linearOAuthConfigured,
          scopes: workProviders.linear.scopes,
        },
      },
      privacy: {
        storesChatPlaintext: false,
        storesIssueBodies: false,
        aiUsesWorkBodiesByDefault: false,
        note:
          "Work-item mirrors stay owner-scoped (title/state/url only). Sophia/AI will not read issue bodies without a separate explicit consent later.",
      },
    };
  });

  app.get("/integrations/work/connections", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const connections = await prisma.integrationConnection.findMany({
      where: {
        ownerUserId: session.sub,
        provider: { in: ["GITHUB", "LINEAR"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    reply.header("Cache-Control", "no-store");
    return { connections: connections.map(serializeConnection) };
  });

  app.get("/integrations/work/:provider/authorize", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const provider = parseWorkProvider(
      (request.params as { provider: string }).provider,
    );
    if (!provider) {
      return reply.code(404).send({ error: "Unknown work provider" });
    }
    if (!providerConfigured(provider)) {
      return reply.code(503).send({
        error: "Work OAuth is not configured on this server",
        missingEnv:
          provider === "github"
            ? [
                "GITHUB_OAUTH_CLIENT_ID",
                "GITHUB_OAUTH_CLIENT_SECRET",
                "API_PUBLIC_ORIGIN",
              ]
            : [
                "LINEAR_OAUTH_CLIENT_ID",
                "LINEAR_OAUTH_CLIENT_SECRET",
                "API_PUBLIC_ORIGIN",
              ],
      });
    }

    const config = workProviders[provider];
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
    url.searchParams.set("state", state);
    if (provider === "github") {
      url.searchParams.set("scope", config.scopes.join(" "));
    } else {
      url.searchParams.set("scope", config.scopes.join(","));
      url.searchParams.set("actor", "user");
      url.searchParams.set("prompt", "consent");
    }

    return { url: url.toString(), scopes: config.scopes };
  });

  app.get("/integrations/work/:provider/callback", async (request, reply) => {
    const provider = parseWorkProvider(
      (request.params as { provider: string }).provider,
    );
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (!provider) {
      return reply.redirect(
        frontendIntegrationsUrl({ work: "error", reason: "unknown_provider" }),
      );
    }
    if (query.error) {
      return reply.redirect(
        frontendIntegrationsUrl({
          work: "error",
          provider,
          reason: "provider_denied",
        }),
      );
    }
    if (!providerConfigured(provider) || !query.code || !query.state) {
      return reply.redirect(
        frontendIntegrationsUrl({
          work: "error",
          provider,
          reason: "invalid_callback",
        }),
      );
    }

    const state = parseOAuthState(query.state, env.JWT_SECRET);
    if (!state || state.provider !== provider) {
      return reply.redirect(
        frontendIntegrationsUrl({
          work: "error",
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
      const accountEmail = await fetchAccountLabel(provider, tokens.accessToken);
      const prismaProvider = workProviders[provider].prismaProvider;

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
          work: "connected",
          provider,
        }),
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.slice(0, 64) : "callback_failed";
      return reply.redirect(
        frontendIntegrationsUrl({
          work: "error",
          provider,
          reason,
        }),
      );
    }
  });

  app.delete("/integrations/work/:provider", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const provider = parseWorkProvider(
      (request.params as { provider: string }).provider,
    );
    if (!provider) {
      return reply.code(404).send({ error: "Unknown work provider" });
    }

    const prismaProvider = workProviders[provider].prismaProvider;
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
      await revokeProviderToken({ provider, token: storedToken });
    } catch {
      // Local revoke still proceeds even if provider revoke is unreachable.
    }

    await prisma.$transaction([
      prisma.workItemMirror.deleteMany({
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

  app.post("/integrations/work/:provider/sync", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const provider = parseWorkProvider(
      (request.params as { provider: string }).provider,
    );
    if (!provider) {
      return reply.code(404).send({ error: "Unknown work provider" });
    }
    if (!providerConfigured(provider)) {
      return reply.code(503).send({
        error: "Work OAuth is not configured on this server",
      });
    }

    const prismaProvider = workProviders[provider].prismaProvider;
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
        error: ownership.ok ? "Work provider is not connected" : ownership.error,
      });
    }

    try {
      let accessToken = connection.accessTokenEncrypted
        ? decryptIntegrationSecret(connection.accessTokenEncrypted)
        : null;
      const expired =
        connection.accessTokenExpiresAt !== null &&
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
            ...(refreshed.refreshToken
              ? {
                  refreshTokenEncrypted: encryptIntegrationSecret(
                    refreshed.refreshToken,
                  ),
                }
              : {}),
            lastErrorCode: null,
          },
        });
      }

      let payload: unknown;
      if (provider === "github") {
        const response = await fetch(GITHUB_ASSIGNED_ISSUES_URL, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "project-2vs-integrations",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          throw new Error(`work_fetch_${response.status}`);
        }
        payload = await response.json();
      } else {
        const response = await fetch(LINEAR_GRAPHQL_URL, {
          method: "POST",
          headers: {
            Authorization: accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: LINEAR_ASSIGNED_ISSUES_QUERY }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          throw new Error(`work_fetch_${response.status}`);
        }
        payload = await response.json();
        if (
          typeof payload === "object" &&
          payload !== null &&
          Array.isArray((payload as { errors?: unknown }).errors) &&
          ((payload as { errors: unknown[] }).errors.length > 0)
        ) {
          throw new Error("work_fetch_graphql_errors");
        }
      }

      const items = normalizeWorkItemsForProvider(provider, payload);
      const syncedAt = new Date();

      await prisma.$transaction([
        prisma.workItemMirror.deleteMany({
          where: {
            ownerUserId: session.sub,
            connectionId: connection.id,
          },
        }),
        ...items.map((item) =>
          prisma.workItemMirror.create({
            data: {
              ownerUserId: session.sub,
              connectionId: connection.id,
              externalItemId: item.externalItemId,
              kind: item.kind,
              number: item.number,
              title: item.title,
              state: item.state,
              url: item.url,
              containerKey: item.containerKey,
              updatedAtExternal: item.updatedAtExternal,
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

      return { synced: items.length };
    } catch (error) {
      const code =
        error instanceof Error ? error.message.slice(0, 64) : "sync_failed";
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: { status: "ERROR", lastErrorCode: code },
      });
      return reply.code(502).send({ error: "Work sync failed", code });
    }
  });

  app.get("/integrations/work/items", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const items = await prisma.workItemMirror.findMany({
      where: { ownerUserId: session.sub },
      orderBy: [{ updatedAtExternal: "desc" }, { syncedAt: "desc" }],
      take: 100,
      include: {
        connection: { select: { provider: true, accountEmail: true } },
      },
    });

    reply.header("Cache-Control", "no-store");
    return {
      items: items.map((item) => ({
        id: item.id,
        provider: item.connection.provider,
        accountEmail: item.connection.accountEmail,
        kind: item.kind,
        number: item.number,
        title: item.title,
        state: item.state,
        url: item.url,
        containerKey: item.containerKey,
        updatedAtExternal: item.updatedAtExternal?.toISOString() ?? null,
        syncedAt: item.syncedAt.toISOString(),
      })),
    };
  });
}

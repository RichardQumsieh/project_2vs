import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import {
  env,
  gmailOAuthConfigured,
  microsoftMailOAuthConfigured,
} from "../env.js";
import {
  emailProviders,
  GMAIL_LIST_URL,
  OUTLOOK_MAIL_LIST_URL,
  parseEmailProvider,
  type EmailProviderId,
} from "../integrations/email-providers.js";
import {
  normalizeGmailMessages,
  normalizeOutlookMailMessages,
} from "../integrations/email-sync.js";
import { createOAuthState, parseOAuthState } from "../integrations/oauth-state.js";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "../integrations/token-crypto.js";
import { denyUnlessOwner } from "../task-authorization.js";

function providerConfigured(provider: EmailProviderId) {
  return provider === "gmail"
    ? gmailOAuthConfigured
    : microsoftMailOAuthConfigured;
}

function clientCredentials(provider: EmailProviderId) {
  if (provider === "gmail") {
    return {
      clientId: env.GOOGLE_MAIL_CLIENT_ID!,
      clientSecret: env.GOOGLE_MAIL_CLIENT_SECRET!,
    };
  }
  return {
    clientId: env.MICROSOFT_MAIL_CLIENT_ID!,
    clientSecret: env.MICROSOFT_MAIL_CLIENT_SECRET!,
  };
}

function callbackUrl(provider: EmailProviderId) {
  const origin = env.API_PUBLIC_ORIGIN!.replace(/\/$/, "");
  return `${origin}/integrations/email/${provider}/callback`;
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
    | "LINEAR";
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
  provider: EmailProviderId;
  code: string;
}) {
  const config = emailProviders[input.provider];
  const credentials = clientCredentials(input.provider);
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code: input.code,
      redirect_uri: callbackUrl(input.provider),
      grant_type: "authorization_code",
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
  if (typeof row.refresh_token !== "string" || !row.refresh_token) {
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
  provider: EmailProviderId;
  refreshToken: string;
}) {
  const config = emailProviders[input.provider];
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

async function fetchGmailMetadata(accessToken: string) {
  const listUrl = new URL(GMAIL_LIST_URL);
  listUrl.searchParams.set("maxResults", "50");
  const listResponse = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!listResponse.ok) {
    throw new Error(`gmail_list_${listResponse.status}`);
  }
  const listPayload: unknown = await listResponse.json();
  const ids =
    typeof listPayload === "object" &&
    listPayload !== null &&
    Array.isArray((listPayload as { messages?: unknown }).messages)
      ? (
          (listPayload as { messages: Array<{ id?: string }> }).messages
        )
          .map((item) => item.id)
          .filter((id): id is string => typeof id === "string")
          .slice(0, 50)
      : [];

  const detailed: unknown[] = [];
  for (const id of ids) {
    const detailUrl = new URL(`${GMAIL_LIST_URL}/${encodeURIComponent(id)}`);
    detailUrl.searchParams.set("format", "metadata");
    detailUrl.searchParams.append("metadataHeaders", "From");
    detailUrl.searchParams.append("metadataHeaders", "Subject");
    const detailResponse = await fetch(detailUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!detailResponse.ok) {
      continue;
    }
    detailed.push(await detailResponse.json());
  }
  return { messages: detailed };
}

export async function integrationEmailRoutes(app: FastifyInstance) {
  app.get("/integrations/email/status", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    return {
      providers: {
        gmail: {
          configured: gmailOAuthConfigured,
          scopes: emailProviders.gmail.scopes,
        },
        "outlook-mail": {
          configured: microsoftMailOAuthConfigured,
          scopes: emailProviders["outlook-mail"].scopes,
        },
      },
      privacy: {
        storesChatPlaintext: false,
        storesFullBodies: false,
        aiUsesMailBodiesByDefault: false,
        note:
          "Mail mirrors store subject/from/snippet only. Full bodies are not persisted for AI without a separate explicit consent later.",
      },
    };
  });

  app.get("/integrations/email/connections", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const connections = await prisma.integrationConnection.findMany({
      where: {
        ownerUserId: session.sub,
        provider: { in: ["GMAIL", "OUTLOOK_MAIL"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    reply.header("Cache-Control", "no-store");
    return { connections: connections.map(serializeConnection) };
  });

  app.get("/integrations/email/:provider/authorize", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const provider = parseEmailProvider(
      (request.params as { provider: string }).provider,
    );
    if (!provider) {
      return reply.code(404).send({ error: "Unknown email provider" });
    }
    if (!providerConfigured(provider)) {
      return reply.code(503).send({
        error: "Email OAuth is not configured on this server",
        missingEnv:
          provider === "gmail"
            ? [
                "GOOGLE_MAIL_CLIENT_ID",
                "GOOGLE_MAIL_CLIENT_SECRET",
                "API_PUBLIC_ORIGIN",
              ]
            : [
                "MICROSOFT_MAIL_CLIENT_ID",
                "MICROSOFT_MAIL_CLIENT_SECRET",
                "API_PUBLIC_ORIGIN",
              ],
      });
    }

    const config = emailProviders[provider];
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
    if (provider === "gmail") {
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "false");
    } else {
      url.searchParams.set("response_mode", "query");
    }
    return { url: url.toString(), scopes: config.scopes };
  });

  app.get("/integrations/email/:provider/callback", async (request, reply) => {
    const provider = parseEmailProvider(
      (request.params as { provider: string }).provider,
    );
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };
    if (!provider) {
      return reply.redirect(
        frontendIntegrationsUrl({ email: "error", reason: "unknown_provider" }),
      );
    }
    if (query.error || !providerConfigured(provider) || !query.code || !query.state) {
      return reply.redirect(
        frontendIntegrationsUrl({
          email: "error",
          provider,
          reason: query.error ? "provider_denied" : "invalid_callback",
        }),
      );
    }
    const state = parseOAuthState(query.state, env.JWT_SECRET);
    if (!state || state.provider !== provider) {
      return reply.redirect(
        frontendIntegrationsUrl({
          email: "error",
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
      const prismaProvider = emailProviders[provider].prismaProvider;
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
        frontendIntegrationsUrl({ email: "connected", provider }),
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.slice(0, 64) : "callback_failed";
      return reply.redirect(
        frontendIntegrationsUrl({ email: "error", provider, reason }),
      );
    }
  });

  app.delete("/integrations/email/:provider", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const provider = parseEmailProvider(
      (request.params as { provider: string }).provider,
    );
    if (!provider) {
      return reply.code(404).send({ error: "Unknown email provider" });
    }
    const prismaProvider = emailProviders[provider].prismaProvider;
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

    const refreshToken = decryptIntegrationSecret(existing!.refreshTokenEncrypted);
    const revokeUrl = emailProviders[provider].revokeUrl;
    if (revokeUrl && providerConfigured(provider)) {
      try {
        await fetch(revokeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // continue local revoke
      }
    }

    await prisma.$transaction([
      prisma.mailMessageMirror.deleteMany({
        where: { ownerUserId: session.sub, connectionId: existing!.id },
      }),
      prisma.integrationConnection.update({
        where: { id: existing!.id },
        data: {
          status: "REVOKED",
          refreshTokenEncrypted: encryptIntegrationSecret("revoked"),
          accessTokenEncrypted: null,
          accessTokenExpiresAt: null,
        },
      }),
    ]);
    return { ok: true };
  });

  app.post("/integrations/email/:provider/sync", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const provider = parseEmailProvider(
      (request.params as { provider: string }).provider,
    );
    if (!provider) {
      return reply.code(404).send({ error: "Unknown email provider" });
    }
    if (!providerConfigured(provider)) {
      return reply.code(503).send({
        error: "Email OAuth is not configured on this server",
      });
    }
    const prismaProvider = emailProviders[provider].prismaProvider;
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
        error: ownership.ok ? "Email is not connected" : ownership.error,
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
          refreshToken: decryptIntegrationSecret(connection.refreshTokenEncrypted),
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

      let messages;
      if (provider === "gmail") {
        const payload = await fetchGmailMetadata(accessToken);
        messages = normalizeGmailMessages(payload);
      } else {
        const url = new URL(OUTLOOK_MAIL_LIST_URL);
        url.searchParams.set("$top", "50");
        url.searchParams.set(
          "$select",
          "id,subject,from,receivedDateTime,bodyPreview,conversationId",
        );
        url.searchParams.set("$orderby", "receivedDateTime desc");
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          throw new Error(`outlook_mail_fetch_${response.status}`);
        }
        messages = normalizeOutlookMailMessages(await response.json());
      }

      const syncedAt = new Date();
      await prisma.$transaction([
        prisma.mailMessageMirror.deleteMany({
          where: { ownerUserId: session.sub, connectionId: connection.id },
        }),
        ...messages.map((message) =>
          prisma.mailMessageMirror.create({
            data: {
              ownerUserId: session.sub,
              connectionId: connection.id,
              externalMessageId: message.externalMessageId,
              threadId: message.threadId,
              subject: message.subject,
              fromAddress: message.fromAddress,
              receivedAt: message.receivedAt,
              snippet: message.snippet,
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

      return { synced: messages.length };
    } catch (error) {
      const code =
        error instanceof Error ? error.message.slice(0, 64) : "sync_failed";
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: { status: "ERROR", lastErrorCode: code },
      });
      return reply.code(502).send({ error: "Email sync failed", code });
    }
  });

  app.get("/integrations/email/messages", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const messages = await prisma.mailMessageMirror.findMany({
      where: { ownerUserId: session.sub },
      orderBy: { receivedAt: "desc" },
      take: 100,
      include: {
        connection: { select: { provider: true, accountEmail: true } },
      },
    });
    reply.header("Cache-Control", "no-store");
    return {
      messages: messages.map((message) => ({
        id: message.id,
        provider: message.connection.provider,
        accountEmail: message.connection.accountEmail,
        subject: message.subject,
        fromAddress: message.fromAddress,
        receivedAt: message.receivedAt.toISOString(),
        snippet: message.snippet,
        syncedAt: message.syncedAt.toISOString(),
      })),
    };
  });
}

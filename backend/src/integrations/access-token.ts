import { prisma } from "../db.js";
import { env } from "../env.js";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "./token-crypto.js";
import { calendarProviders, type CalendarProviderId } from "./calendar-providers.js";
import { emailProviders, type EmailProviderId } from "./email-providers.js";
import { workProviders, type WorkProviderId } from "./work-providers.js";
import type { CollabProviderId } from "./collab-providers.js";

type ConnectionRow = {
  id: string;
  refreshTokenEncrypted: string;
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
};

async function oauthRefresh(input: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  const response = await fetch(input.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
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
  const row = result as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
  const expiresIn =
    typeof row.expires_in === "number" && Number.isFinite(row.expires_in)
      ? row.expires_in
      : 3600;
  return {
    accessToken: row.access_token,
    accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    refreshToken:
      typeof row.refresh_token === "string" && row.refresh_token
        ? row.refresh_token
        : undefined,
  };
}

async function persistAccessToken(
  connectionId: string,
  accessToken: string,
  accessTokenExpiresAt: Date | null,
  refreshToken?: string,
) {
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: {
      accessTokenEncrypted: encryptIntegrationSecret(accessToken),
      accessTokenExpiresAt,
      ...(refreshToken
        ? { refreshTokenEncrypted: encryptIntegrationSecret(refreshToken) }
        : {}),
      lastErrorCode: null,
    },
  });
}

function needsRefresh(connection: ConnectionRow, accessToken: string | null) {
  if (!accessToken) {
    return true;
  }
  if (!connection.accessTokenExpiresAt) {
    return false;
  }
  return connection.accessTokenExpiresAt.getTime() <= Date.now() + 60_000;
}

export async function resolveCalendarAccessToken(
  provider: CalendarProviderId,
  connection: ConnectionRow,
) {
  let accessToken = connection.accessTokenEncrypted
    ? decryptIntegrationSecret(connection.accessTokenEncrypted)
    : null;
  if (!needsRefresh(connection, accessToken)) {
    return accessToken!;
  }
  const refreshToken = decryptIntegrationSecret(connection.refreshTokenEncrypted);
  const config = calendarProviders[provider];
  const credentials =
    provider === "google"
      ? {
          clientId: env.GOOGLE_CALENDAR_CLIENT_ID!,
          clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
        }
      : {
          clientId: env.MICROSOFT_CALENDAR_CLIENT_ID!,
          clientSecret: env.MICROSOFT_CALENDAR_CLIENT_SECRET!,
        };
  const refreshed = await oauthRefresh({
    tokenUrl: config.tokenUrl,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken,
  });
  await persistAccessToken(
    connection.id,
    refreshed.accessToken,
    refreshed.accessTokenExpiresAt,
  );
  return refreshed.accessToken;
}

export async function resolveEmailAccessToken(
  provider: EmailProviderId,
  connection: ConnectionRow,
) {
  let accessToken = connection.accessTokenEncrypted
    ? decryptIntegrationSecret(connection.accessTokenEncrypted)
    : null;
  if (!needsRefresh(connection, accessToken)) {
    return accessToken!;
  }
  const refreshToken = decryptIntegrationSecret(connection.refreshTokenEncrypted);
  const config = emailProviders[provider];
  const credentials =
    provider === "gmail"
      ? {
          clientId: env.GOOGLE_MAIL_CLIENT_ID!,
          clientSecret: env.GOOGLE_MAIL_CLIENT_SECRET!,
        }
      : {
          clientId: env.MICROSOFT_MAIL_CLIENT_ID!,
          clientSecret: env.MICROSOFT_MAIL_CLIENT_SECRET!,
        };
  const refreshed = await oauthRefresh({
    tokenUrl: config.tokenUrl,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken,
  });
  await persistAccessToken(
    connection.id,
    refreshed.accessToken,
    refreshed.accessTokenExpiresAt,
  );
  return refreshed.accessToken;
}

export async function resolveWorkAccessToken(
  provider: WorkProviderId,
  connection: ConnectionRow,
) {
  const stored = decryptIntegrationSecret(connection.refreshTokenEncrypted);
  if (provider === "github") {
    return stored;
  }
  let accessToken = connection.accessTokenEncrypted
    ? decryptIntegrationSecret(connection.accessTokenEncrypted)
    : null;
  if (!needsRefresh(connection, accessToken)) {
    return accessToken!;
  }
  const config = workProviders.linear;
  try {
    const refreshed = await oauthRefresh({
      tokenUrl: config.tokenUrl,
      clientId: env.LINEAR_OAUTH_CLIENT_ID!,
      clientSecret: env.LINEAR_OAUTH_CLIENT_SECRET!,
      refreshToken: stored,
    });
    await persistAccessToken(
      connection.id,
      refreshed.accessToken,
      refreshed.accessTokenExpiresAt,
      refreshed.refreshToken,
    );
    return refreshed.accessToken;
  } catch {
    // Linear may store a non-expiring access token in the refresh slot.
    return stored;
  }
}

export async function resolveCollabAccessToken(
  _provider: CollabProviderId,
  connection: ConnectionRow,
) {
  // Slack user tokens from oauth.v2.access are stored in the refresh slot.
  if (connection.accessTokenEncrypted) {
    const accessToken = decryptIntegrationSecret(connection.accessTokenEncrypted);
    if (!needsRefresh(connection, accessToken)) {
      return accessToken;
    }
  }
  return decryptIntegrationSecret(connection.refreshTokenEncrypted);
}

export async function providerFetch(
  url: string,
  input: {
    method: "POST" | "PATCH";
    accessToken: string;
    body: unknown;
    headers?: Record<string, string>;
  },
) {
  const response = await fetch(url, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...input.headers,
    },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { ok: response.ok, status: response.status, json };
}

const maxProviderReadChars = 1_500_000;

/** GET a provider resource. The caller parses json and must not log it. */
export async function providerRead(url: string, accessToken: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (text.length > maxProviderReadChars) {
    return {
      ok: false,
      status: response.status,
      json: null,
      tooLarge: true as const,
    };
  }
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
    tooLarge: false as const,
  };
}

/** DELETE a provider resource. The response body is discarded and never logged. */
export async function providerDelete(url: string, accessToken: string) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  await response.body?.cancel().catch(() => undefined);
  return { ok: response.ok, status: response.status };
}

import { createHmac, timingSafeEqual } from "node:crypto";
import type { CalendarProviderId } from "./calendar-providers.js";
import type { CollabProviderId } from "./collab-providers.js";
import type { EmailProviderId } from "./email-providers.js";
import type { WorkProviderId } from "./work-providers.js";

const stateTtlMs = 10 * 60 * 1000;

export type OAuthIntegrationProvider =
  | CalendarProviderId
  | EmailProviderId
  | WorkProviderId
  | CollabProviderId;

export type OAuthStatePayload = {
  userId: string;
  provider: OAuthIntegrationProvider;
  nonce: string;
  exp: number;
};

function isKnownProvider(value: unknown): value is OAuthIntegrationProvider {
  return (
    value === "google" ||
    value === "outlook" ||
    value === "gmail" ||
    value === "outlook-mail" ||
    value === "github" ||
    value === "linear" ||
    value === "slack"
  );
}

function sign(payloadB64: string, secret: string) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createOAuthState(
  input: {
    userId: string;
    provider: OAuthIntegrationProvider;
    nonce: string;
    now?: Date;
  },
  secret: string,
) {
  const payload: OAuthStatePayload = {
    userId: input.userId,
    provider: input.provider,
    nonce: input.nonce.slice(0, 64),
    exp: (input.now ?? new Date()).getTime() + stateTtlMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export function parseOAuthState(
  value: string,
  secret: string,
  now = new Date(),
): OAuthStatePayload | null {
  const [payloadB64, signature] = value.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }
  const expected = sign(payloadB64, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as Partial<OAuthStatePayload>;
    if (
      typeof parsed.userId !== "string" ||
      !parsed.userId ||
      !isKnownProvider(parsed.provider) ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.exp !== "number" ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp <= now.getTime()
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      provider: parsed.provider,
      nonce: parsed.nonce,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

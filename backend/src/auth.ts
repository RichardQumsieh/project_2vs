import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { prisma } from "./db.js";
import { env } from "./env.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const issuer = "private-messenger";
const audience = "private-messenger";

export type SessionClaims = {
  sub: string;
  username: string;
};

export async function signSession(claims: SessionClaims) {
  const sessionId = randomUUID();
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  );

  await prisma.authSession.create({
    data: {
      id: sessionId,
      userId: claims.sub,
      expiresAt,
    },
  });

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(sessionId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySession(token: string) {
  const { payload } = await jwtVerify(token, secret, {
    issuer,
    audience,
    algorithms: ["HS256"],
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.username !== "string" ||
    typeof payload.jti !== "string"
  ) {
    throw new Error("Invalid session");
  }
  return {
    sub: payload.sub,
    username: payload.username,
    sessionId: payload.jti,
  };
}

export async function createTotpSetupToken(userId: string) {
  return new SignJWT({
    purpose: "totp-setup",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

export async function verifyTotpSetupToken(token: string) {
  const { payload } = await jwtVerify(token, secret, {
    issuer,
    audience,
    algorithms: ["HS256"],
  });

  if (
    payload.purpose !== "totp-setup" ||
    typeof payload.sub !== "string"
  ) {
    throw new Error("Invalid TOTP setup token");
  }

  return payload.sub;
}

/**
 * Cross-site SPA → API (e.g. sophia.apps.grok.bot → api.sophia-build.com) needs
 * SameSite=None; Secure so credentialed fetch can send the session cookie.
 * Local http keeps Lax (browsers reject SameSite=None without Secure).
 *
 * Deploy check: GET /health → cookieSameSite must be "none" in prod. Live
 * Set-Cookie showing Secure+Lax means COOKIE_SECURE is true but this build
 * is missing the SameSite=None change (rebuild backend image from main).
 */
export function authCookieSameSite(): "none" | "lax" {
  return env.COOKIE_SECURE ? "none" : "lax";
}

export function authCookieBase() {
  return {
    httpOnly: true as const,
    sameSite: authCookieSameSite(),
    secure: env.COOKIE_SECURE,
    path: "/",
  };
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(env.COOKIE_NAME, token, {
    ...authCookieBase(),
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(env.COOKIE_NAME, {
    path: "/",
    secure: env.COOKIE_SECURE,
    sameSite: authCookieSameSite(),
  });
}

export async function getSession(request: FastifyRequest) {
  const token = request.cookies[env.COOKIE_NAME];
  if (!token) return null;

  let claims: Awaited<ReturnType<typeof verifySession>>;
  try {
    claims = await verifySession(token);
  } catch {
    return null;
  }

  const session = await prisma.authSession.findUnique({
    where: { id: claims.sessionId },
    select: {
      userId: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (
    !session ||
    session.userId !== claims.sub ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  ) {
    return null;
  }

  return {
    ...claims,
    expiresAt: session.expiresAt,
  };
}

export async function revokeSession(sessionId: string) {
  await prisma.authSession.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const session = await getSession(request);
  if (!session) {
    reply.code(401).send({ error: "Unauthorized" });
    return null;
  }
  return session;
}

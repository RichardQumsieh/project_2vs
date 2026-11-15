import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import {
  beginTotpSetup as createTotpSetup,
  createOpaqueToken,
  createRecoveryCodes,
  decryptTotpSecret,
  encryptTotpSecret,
  hashRecoveryCode,
  hashToken,
  sendPasswordResetEmail,
  verifyTotp,
} from "../auth-security.js";
import {
  clearSessionCookie,
  createTotpSetupToken,
  getSession,
  requireUser,
  revokeSession,
  setSessionCookie,
  signSession,
  verifyTotpSetupToken,
} from "../auth.js";
import { env, gmailConfigured } from "../env.js";
import { prisma } from "../db.js";
import {
  confirmTotpSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "../schemas.js";
import { publicUser } from "../util.js";
import { networkPrefixForIp } from "../trusted-browser.js";
import {
  closeSessionSockets,
  closeUserSockets,
} from "../ws.js";

const resetTokenLifetimeMs = 30 * 60 * 1000;
const trustedBrowserCookieName = "messenger_trusted_browser";
const trustedBrowserLifetimeMs = 30 * 24 * 60 * 60 * 1000;

async function beginTotpSetup(
  user: { id: string; email: string },
) {
  const setup = createTotpSetup(user.email);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      pendingTotpSecret: encryptTotpSecret(setup.secret),
      totpSetupExpiresAt: expiresAt,
    },
  });

  return {
    setupRequired: true as const,
    setupToken: await createTotpSetupToken(user.id),
    secret: setup.secret,
    otpauthUrl: setup.otpauthUrl,
  };
}

async function verifyAndConsumeLoginFactor(
  userId: string,
  encryptedSecret: string,
  code: string,
): Promise<"totp" | "recovery" | false> {
  if (/^\d{6}$/.test(code)) {
    const secret = decryptTotpSecret(encryptedSecret);
    if (await verifyTotp(secret, code)) {
      return "totp";
    }
  }

  const recoveryCode = await prisma.recoveryCode.findFirst({
    where: {
      userId,
      codeHash: hashRecoveryCode(code),
      usedAt: null,
    },
    select: { id: true },
  });

  if (!recoveryCode) {
    return false;
  }

  const consumed = await prisma.recoveryCode.updateMany({
    where: {
      id: recoveryCode.id,
      usedAt: null,
    },
    data: { usedAt: new Date() },
  });

  return consumed.count === 1 ? "recovery" : false;
}

function setTrustedBrowserCookie(reply: Parameters<typeof setSessionCookie>[0], token: string) {
  reply.setCookie(trustedBrowserCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    path: "/",
    maxAge: trustedBrowserLifetimeMs / 1000,
  });
}

function clearTrustedBrowserCookie(reply: Parameters<typeof clearSessionCookie>[0]) {
  reply.clearCookie(trustedBrowserCookieName, {
    path: "/",
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/auth/register",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (await getSession(request)) {
        return reply.code(409).send({
          error: "Sign out before creating or switching accounts",
        });
      }

      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid input",
          details: parsed.error.flatten(),
        });
      }

      const {
        username,
        email,
        password,
        displayName,
      } = parsed.data;

      const existing = await prisma.user.findFirst({
        where: {
          OR: [{ email }, { username }],
        },
        select: { id: true },
      });
      if (existing) {
        return reply.code(409).send({
          error: "Email or username already in use",
        });
      }

      let user;
      try {
        user = await prisma.user.create({
          data: {
            username,
            email,
            passwordHash: await argon2.hash(password, {
              type: argon2.argon2id,
            }),
            displayName: displayName ?? username,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          return reply.code(409).send({
            error: "Email or username already in use",
          });
        }
        throw error;
      }

      reply.header("Cache-Control", "no-store");
      return beginTotpSetup(user);
    },
  );

  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (await getSession(request)) {
        return reply.code(409).send({
          error: "Sign out before switching accounts",
        });
      }

      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }

      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email },
      });

      if (
        !user ||
        !(await argon2.verify(
          user.passwordHash,
          parsed.data.password,
        ))
      ) {
        return reply.code(401).send({
          error: "Invalid email or password",
        });
      }

      if (!user.totpSecret) {
        reply.header("Cache-Control", "no-store");
        return beginTotpSetup(user);
      }

      const currentNetworkPrefix = networkPrefixForIp(request.ip);
      const trustedBrowserToken = request.cookies[trustedBrowserCookieName];
      const trustedBrowser = trustedBrowserToken
        ? await prisma.trustedBrowser.findUnique({
            where: { tokenHash: hashToken(trustedBrowserToken) },
            select: { id: true, userId: true, networkPrefix: true, expiresAt: true },
          })
        : null;
      if (trustedBrowser && trustedBrowser.expiresAt <= new Date()) {
        await prisma.trustedBrowser.deleteMany({
          where: { id: trustedBrowser.id },
        });
      }
      const trustedBrowserIsValid = Boolean(
        trustedBrowser &&
        trustedBrowser.userId === user.id &&
        trustedBrowser.expiresAt > new Date() &&
        currentNetworkPrefix &&
        trustedBrowser.networkPrefix === currentNetworkPrefix,
      );

      if (!parsed.data.code) {
        if (trustedBrowserIsValid) {
          await prisma.trustedBrowser.update({
            where: { id: trustedBrowser!.id },
            data: { lastUsedAt: new Date() },
          });
          const token = await signSession({
            sub: user.id,
            username: user.username,
          });
          setSessionCookie(reply, token);
          reply.header("Cache-Control", "no-store");
          return {
            setupRequired: false,
            user: publicUser(user),
          };
        }
        reply.header("Cache-Control", "no-store");
        return {
          mfaRequired: true as const,
          reason: trustedBrowser &&
            trustedBrowser.userId === user.id &&
            trustedBrowser.expiresAt > new Date()
            ? "network_changed" as const
            : "new_browser" as const,
        };
      }

      const validFactor = await verifyAndConsumeLoginFactor(
        user.id,
        user.totpSecret,
        parsed.data.code,
      );

      if (!validFactor) {
        return reply.code(401).send({
          error: "Invalid email, password, or authenticator code",
        });
      }

      if (validFactor === "totp" && parsed.data.trustBrowser) {
        const trustedToken = createOpaqueToken();
        const expiresAt = new Date(Date.now() + trustedBrowserLifetimeMs);
        await prisma.$transaction(async (tx) => {
          if (trustedBrowserToken) {
            await tx.trustedBrowser.deleteMany({
              where: { tokenHash: hashToken(trustedBrowserToken) },
            });
          }
          await tx.trustedBrowser.create({
            data: {
              userId: user.id,
              tokenHash: hashToken(trustedToken),
              networkPrefix: currentNetworkPrefix,
              expiresAt,
            },
          });
        });
        setTrustedBrowserCookie(reply, trustedToken);
      } else {
        if (trustedBrowserToken) {
          await prisma.trustedBrowser.deleteMany({
            where: { tokenHash: hashToken(trustedBrowserToken) },
          });
        }
        clearTrustedBrowserCookie(reply);
      }

      const token = await signSession({
        sub: user.id,
        username: user.username,
      });
      setSessionCookie(reply, token);
      reply.header("Cache-Control", "no-store");
      return {
        setupRequired: false,
        user: publicUser(user),
      };
    },
  );

  app.post(
    "/auth/totp/confirm",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      const parsed = confirmTotpSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }

      let userId: string;
      try {
        userId = await verifyTotpSetupToken(
          parsed.data.setupToken,
        );
      } catch {
        return reply.code(401).send({
          error: "Your authenticator setup expired. Sign in to restart it.",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          pendingTotpSecret: true,
          totpSetupExpiresAt: true,
        },
      });

      if (
        !user?.pendingTotpSecret ||
        !user.totpSetupExpiresAt ||
        user.totpSetupExpiresAt <= new Date()
      ) {
        return reply.code(401).send({
          error: "Your authenticator setup expired. Sign in to restart it.",
        });
      }

      const pendingSecret = user.pendingTotpSecret;
      if (
        !(await verifyTotp(
          decryptTotpSecret(pendingSecret),
          parsed.data.code,
        ))
      ) {
        return reply.code(401).send({
          error: "That authenticator code is not valid",
        });
      }

      const recoveryCodes = createRecoveryCodes();
      const now = new Date();
      const activated = await prisma.$transaction(async (tx) => {
        const result = await tx.user.updateMany({
          where: {
            id: user.id,
            pendingTotpSecret: pendingSecret,
            totpSetupExpiresAt: { gt: now },
            totpSecret: null,
          },
          data: {
            totpSecret: pendingSecret,
            pendingTotpSecret: null,
            totpSetupExpiresAt: null,
          },
        });

        if (result.count !== 1) {
          return false;
        }

        await tx.recoveryCode.deleteMany({
          where: { userId: user.id },
        });
        await tx.recoveryCode.createMany({
          data: recoveryCodes.map((code) => ({
            userId: user.id,
            codeHash: hashRecoveryCode(code),
          })),
        });
        return true;
      });

      if (!activated) {
        return reply.code(409).send({
          error: "Authenticator setup has already been completed",
        });
      }

      if (parsed.data.trustBrowser) {
        const trustedToken = createOpaqueToken();
        await prisma.trustedBrowser.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(trustedToken),
            networkPrefix: networkPrefixForIp(request.ip),
            expiresAt: new Date(Date.now() + trustedBrowserLifetimeMs),
          },
        });
        setTrustedBrowserCookie(reply, trustedToken);
      }

      const token = await signSession({
        sub: user.id,
        username: user.username,
      });
      setSessionCookie(reply, token);
      reply.header("Cache-Control", "no-store");

      return {
        user: publicUser({
          ...user,
          displayName: null,
          avatarUrl: null,
        }),
        recoveryCodes,
      };
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const session = await getSession(request);
    if (session) {
      await revokeSession(session.sessionId);
      closeSessionSockets(session.sessionId);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post(
    "/auth/password/forgot",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      const parsed = forgotPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid email" });
      }

      if (!gmailConfigured) {
        return reply.code(503).send({
          error: "Password recovery email is not configured",
        });
      }

      const user = await prisma.user.findUnique({
        where: { email: parsed.data.email },
        select: { id: true, email: true },
      });

      if (!user) {
        return reply.code(202).send({
          ok: true,
          message: "If an account exists, a reset link will be sent.",
        });
      }

      const rawToken = createOpaqueToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(
        Date.now() + resetTokenLifetimeMs,
      );

      await prisma.authToken.deleteMany({
        where: {
          userId: user.id,
          consumedAt: null,
        },
      });
      await prisma.authToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      const resetUrl = new URL(
        `/reset-password?token=${encodeURIComponent(rawToken)}`,
        env.FRONTEND_ORIGIN,
      ).toString();

      try {
        await sendPasswordResetEmail(
          user.email,
          resetUrl,
        );
      } catch (error) {
        request.log.error(
          { err: error },
          "Password reset email delivery failed",
        );
        await prisma.authToken.deleteMany({
          where: { tokenHash },
        });
        return reply.code(503).send({
          error: "Could not send the password reset email",
        });
      }

      return reply.code(202).send({
        ok: true,
        message: "If an account exists, a reset link will be sent.",
      });
    },
  );

  app.post(
    "/auth/password/reset",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }

      const tokenHash = hashToken(parsed.data.token);
      const resetToken = await prisma.authToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            select: {
              id: true,
              totpSecret: true,
            },
          },
        },
      });
      const now = new Date();

      if (
        !resetToken ||
        resetToken.consumedAt ||
        resetToken.expiresAt <= now
      ) {
        return reply.code(400).send({
          error: "This password reset link is invalid or expired",
        });
      }

      // Password reset always requires an enrolled authenticator factor.
      // Incomplete TOTP setup must not reset with the email link alone.
      if (!resetToken.user.totpSecret) {
        return reply.code(400).send({
          error:
            "Finish authenticator setup before resetting your password, or contact support if you are locked out.",
        });
      }

      const totpValid =
        /^\d{6}$/.test(parsed.data.code) &&
        (await verifyTotp(
          decryptTotpSecret(resetToken.user.totpSecret),
          parsed.data.code,
        ));

      const passwordHash = await argon2.hash(
        parsed.data.password,
        { type: argon2.argon2id },
      );
      const resetAt = new Date();
      const result = await prisma.$transaction(async (tx) => {
        const currentToken = await tx.authToken.findUnique({
          where: { tokenHash },
          select: {
            userId: true,
            expiresAt: true,
            consumedAt: true,
          },
        });

        if (
          !currentToken ||
          currentToken.userId !== resetToken.userId ||
          currentToken.consumedAt ||
          currentToken.expiresAt <= resetAt
        ) {
          return false;
        }

        if (!totpValid) {
          const consumedCode = await tx.recoveryCode.updateMany({
            where: {
              userId: resetToken.userId,
              codeHash: hashRecoveryCode(parsed.data.code),
              usedAt: null,
            },
            data: { usedAt: resetAt },
          });

          if (consumedCode.count !== 1) {
            return false;
          }
        }

        const consumedToken = await tx.authToken.updateMany({
          where: {
            tokenHash,
            consumedAt: null,
            expiresAt: { gt: resetAt },
          },
          data: { consumedAt: resetAt },
        });

        if (consumedToken.count !== 1) {
          return false;
        }

        await tx.user.update({
          where: { id: resetToken.userId },
          data: {
            passwordHash,
            vaultVersion: { increment: 1 },
            pendingTotpSecret: null,
            totpSetupExpiresAt: null,
          },
        });
        await tx.authSession.updateMany({
          where: {
            userId: resetToken.userId,
            revokedAt: null,
          },
          data: { revokedAt: resetAt },
        });
        await tx.trustedBrowser.deleteMany({
          where: { userId: resetToken.userId },
        });
        await tx.device.updateMany({
          where: {
            userId: resetToken.userId,
            revokedAt: null,
          },
          data: { revokedAt: resetAt },
        });
        await tx.authToken.updateMany({
          where: {
            userId: resetToken.userId,
            consumedAt: null,
          },
          data: { consumedAt: resetAt },
        });

        return true;
      });

      if (!result) {
        return reply.code(401).send({
          error: "Invalid reset link or authenticator code",
        });
      }

      closeUserSockets(resetToken.userId);

      return {
        ok: true,
        vaultResetRequired: true,
      };
    },
  );

  app.get("/me", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const session = await requireUser(request, reply);
    if (!session) return;

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      include: {
        devices: {
          where: { revokedAt: null },
          select: {
            id: true,
            deviceName: true,
            createdAt: true,
            lastSeenAt: true,
          },
        },
      },
    });
    if (!user) return reply.code(401).send({ error: "Unauthorized" });

    return {
      user: {
        ...publicUser(user),
        interests: user.interests,
        vaultVersion: user.vaultVersion,
      },
      devices: user.devices,
    };
  });
}

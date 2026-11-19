import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { authCookieSameSite } from "./auth.js";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { redis, redisSub } from "./redis.js";
import { authRoutes } from "./routes/auth.js";
import { deviceRoutes } from "./routes/devices.js";
import { conversationRoutes } from "./routes/conversations.js";
import { groupRoutes } from "./routes/groups.js";
import { researchRoutes } from "./routes/research.js";
import { urlSafetyRoutes } from "./routes/url-safety.js";
import { registerCallIceServerRoute } from "./call-signaling.js";
import { mediaRoutes } from "./routes/media.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { taskRoutes } from "./routes/tasks.js";
import { aiConsentRoutes } from "./routes/ai-consents.js";
import { accountActivityRoutes } from "./routes/account-activity.js";
import { cloudSophiaRoutes } from "./routes/cloud-sophia.js";
import { integrationCalendarRoutes } from "./routes/integrations-calendar.js";
import { integrationEmailRoutes } from "./routes/integrations-email.js";
import { integrationWorkRoutes } from "./routes/integrations-work.js";
import { integrationCollabRoutes } from "./routes/integrations-collab.js";
import { integrationWriteRoutes } from "./routes/integrations-write.js";
import { registerRealtime } from "./ws.js";

const app = Fastify({ logger: true });

const allowedOrigin = new URL(env.FRONTEND_ORIGIN).origin;

await app.register(cors, {
  origin: allowedOrigin,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});
await app.register(cookie);
await app.register(websocket, {
  options: { maxPayload: 96 * 1024 },
});
await app.register(rateLimit, {
  max: 120,
  timeWindow: "1 minute",
});

app.addHook("onRequest", async (request, reply) => {
  if (
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "OPTIONS"
  ) {
    return;
  }

  if (request.headers.origin !== allowedOrigin) {
    return reply.code(403).send({
      error: "Invalid request origin",
    });
  }
});

app.get("/health", async () => ({
  ok: true,
  // Public deploy probe: confirms whether this image will emit SameSite=None
  // (COOKIE_SECURE=true) vs Lax. No secrets.
  cookieSecure: env.COOKIE_SECURE,
  cookieSameSite: authCookieSameSite(),
  groupE2ee: env.GROUP_E2EE_ENABLED,
}));

app.log.info(
  {
    cookieSecure: env.COOKIE_SECURE,
    cookieSameSite: authCookieSameSite(),
    frontendOrigin: allowedOrigin,
  },
  "auth cookie mode",
);

await app.register(authRoutes);
await app.register(deviceRoutes);
await app.register(conversationRoutes);
await app.register(groupRoutes);
await app.register(mediaRoutes);
await app.register(discoveryRoutes);
await app.register(researchRoutes);
await app.register(urlSafetyRoutes);
await app.register(taskRoutes);
await app.register(aiConsentRoutes);
await app.register(accountActivityRoutes);
await app.register(cloudSophiaRoutes);
await app.register(integrationCalendarRoutes);
await app.register(integrationEmailRoutes);
await app.register(integrationWorkRoutes);
await app.register(integrationCollabRoutes);
await app.register(integrationWriteRoutes);
await registerCallIceServerRoute(app);
await registerRealtime(app);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  redisSub.disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.PORT, host: "0.0.0.0" });

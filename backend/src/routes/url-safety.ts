import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { env } from "../env.js";
import { checkUrlReputation, normalizeReputationUrl } from "../url-reputation.js";
import { urlSafetyCheckSchema } from "../schemas.js";

export async function urlSafetyRoutes(app: FastifyInstance) {
  app.post(
    "/url-safety/check",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const parsed = urlSafetyCheckSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Provide up to 500 valid URLs within the request size limit." });
      }
      const normalized = parsed.data.urls.map(normalizeReputationUrl);
      if (normalized.some((url) => url === null)) {
        return reply.code(400).send({ error: "One or more URLs use an invalid or unsupported format." });
      }

      try {
        const results = await checkUrlReputation(parsed.data.urls, {
          apiKey: env.SAFE_BROWSING_API_KEY,
        });
        return { results };
      } catch (error) {
        request.log.warn("URL reputation check failed");
        return reply.code(502).send({
          error: error instanceof Error
            ? error.message
            : "URL reputation service could not complete the check.",
        });
      }
    },
  );
}

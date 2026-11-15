import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { env } from "../env.js";
import { extractBraveSources } from "../research-provider.js";
import { researchSearchSchema } from "../schemas.js";

const maxResults = 4;

export async function researchRoutes(app: FastifyInstance) {
  app.post(
    "/research/search",
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;

      const parsed = researchSearchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Research queries must contain 1 to 300 characters." });
      }
      if (!env.BRAVE_SEARCH_API_KEY) {
        return reply.code(503).send({ error: "Online research is not configured on this server." });
      }

      const queryUrl = new URL("https://api.search.brave.com/res/v1/web/search");
      queryUrl.searchParams.set("q", parsed.data.query);
      queryUrl.searchParams.set("count", String(maxResults));
      if (/[\u0600-\u06ff]/.test(parsed.data.query)) {
        queryUrl.searchParams.set("search_lang", "ar");
      }

      let response: Response;
      try {
        response = await fetch(queryUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
          },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        return reply.code(502).send({ error: "The web search provider could not be reached." });
      }

      if (!response.ok) {
        return reply.code(502).send({ error: "The web search provider could not complete the request." });
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return reply.code(502).send({ error: "The web search provider returned an invalid response." });
      }

      const sources = extractBraveSources(payload);
      if (!sources) {
        return reply.code(502).send({ error: "The web search provider returned an unsupported response." });
      }
      if (!sources.length) {
        return reply.code(404).send({ error: "No useful public sources were found." });
      }
      return { sources };
    },
  );
}

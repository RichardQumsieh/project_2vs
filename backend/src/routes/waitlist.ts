import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { designPartnerSchema } from "../schemas.js";

export async function waitlistRoutes(app: FastifyInstance) {
  app.post(
    "/waitlist",
    {
      bodyLimit: 2 * 1024,
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const parsed = designPartnerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Enter an email address.",
          code: "invalid_waitlist",
        });
      }
      await prisma.designPartnerRequest.create({
        data: {
          email: parsed.data.email.toLowerCase(),
          locale: parsed.data.locale ?? "en",
          note: parsed.data.note ?? "",
        },
      });
      reply.header("Cache-Control", "no-store");
      request.log.info({ waitlist: true, outcome: "stored" }, "design partner");
      return reply.code(201).send({ ok: true as const });
    },
  );
}

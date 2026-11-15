import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { prisma } from "../db.js";
import { denyUnlessOwner } from "../task-authorization.js";
import { createAiConsentSchema } from "../schemas.js";

export async function aiConsentRoutes(app: FastifyInstance) {
  app.post("/ai/consents", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const parsed = createAiConsentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid AI consent" });
    }

    const consent = await prisma.aiAuthorizationConsent.create({
      data: {
        userId: session.sub,
        scope: parsed.data.scope,
        conversationId: parsed.data.conversationId,
        evidenceVersion: parsed.data.evidenceVersion,
      },
    });

    return reply.code(201).send({
      consent: {
        id: consent.id,
        scope: consent.scope,
        conversationId: consent.conversationId,
        grantedAt: consent.grantedAt.toISOString(),
        revokedAt: consent.revokedAt?.toISOString() ?? null,
        evidenceVersion: consent.evidenceVersion,
      },
    });
  });

  app.delete("/ai/consents/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;

    const { id } = request.params as { id: string };
    const existing = await prisma.aiAuthorizationConsent.findUnique({
      where: { id },
      select: { userId: true, revokedAt: true },
    });
    const ownership = denyUnlessOwner({
      ownerUserId: existing?.userId,
      sessionUserId: session.sub,
    });
    if (!ownership.ok) {
      return reply.code(ownership.status).send({ error: ownership.error });
    }

    if (!existing?.revokedAt) {
      await prisma.aiAuthorizationConsent.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  });
}

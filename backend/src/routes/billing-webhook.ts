import type { FastifyInstance } from "fastify";
import { interpretStripeEvent, verifyStripeSignature } from "../billing.js";
import { prisma } from "../db.js";
import { billingEnabled, env } from "../env.js";
import { isPlanId } from "../plans.js";

/** Stripe webhooks. Raw body, signature checked, no card data stored. */
export async function billingWebhookRoutes(app: FastifyInstance) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.post(
    "/billing/stripe/webhook",
    {
      bodyLimit: 64 * 1024,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!billingEnabled || env.BILLING_PROVIDER !== "stripe") {
        return reply.code(404).send({ error: "Billing webhooks are off." });
      }
      const raw = typeof request.body === "string" ? request.body : "";
      const header = request.headers["stripe-signature"];
      const signature = Array.isArray(header) ? header[0] : header;
      if (!env.STRIPE_WEBHOOK_SECRET || !verifyStripeSignature({
        rawBody: raw,
        header: signature,
        secret: env.STRIPE_WEBHOOK_SECRET,
        nowSec: Math.floor(Date.now() / 1000),
      })) {
        return reply.code(400).send({ error: "Invalid billing signature." });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: "Invalid billing event." });
      }
      const event = interpretStripeEvent(payload);
      try {
        if (event.type === "activated" && isPlanId(event.planId)) {
          await prisma.workspace.update({
            where: { id: event.workspaceId },
            data: {
              planId: event.planId,
              billing: {
                upsert: {
                  create: {
                    provider: "stripe",
                    status: "active",
                    externalCustomerId: event.customerId,
                    externalSubscriptionId: event.subscriptionId,
                  },
                  update: {
                    provider: "stripe",
                    status: "active",
                    externalCustomerId: event.customerId ?? undefined,
                    externalSubscriptionId: event.subscriptionId ?? undefined,
                  },
                },
              },
            },
          });
        } else if (event.type === "canceled") {
          await prisma.workspaceBilling.updateMany({
            where: { workspaceId: event.workspaceId },
            data: { status: "canceled" },
          });
        }
      } catch {
        request.log.info({ billing: true, outcome: "ignored" }, "billing webhook");
        return { ok: true as const };
      }
      request.log.info({ billing: true, outcome: event.type }, "billing webhook");
      return { ok: true as const };
    },
  );
}

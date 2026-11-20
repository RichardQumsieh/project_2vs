import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { interpretStripeEvent, verifyStripeSignature } from "../billing.js";
import { billingProvider } from "../billing-runtime.js";
import { prisma } from "../db.js";
import { billingEnabled, env } from "../env.js";
import { isPlanId } from "../plans.js";
import {
  processPayPalWebhook,
  type PayPalWorkspaceEvent,
} from "../paypal-billing.js";

/** Stripe and PayPal webhooks. Raw body, signature checked, no card data or tokens stored. */
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

  app.post(
    "/billing/paypal/webhook",
    {
      bodyLimit: 64 * 1024,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!billingEnabled || env.BILLING_PROVIDER !== "paypal") {
        return reply.code(404).send({ error: "Billing webhooks are off." });
      }
      const raw = typeof request.body === "string" ? request.body : "";
      const headers = paypalHeaders(request.headers);
      try {
        const result = await processPayPalWebhook({
          rawBody: raw,
          headers,
          plans: {
            FAMILY_PLUS: env.PAYPAL_PLAN_FAMILY_PLUS,
            TEAM: env.PAYPAL_PLAN_TEAM_SEAT,
          },
          verify: (webhookHeaders, rawBody) => billingProvider.verifyWebhook({
            rawBody,
            headers: webhookHeaders,
          }),
          commit: commitPayPalEvent,
        });
        if (result.httpStatus === 400) {
          request.log.info({ billing: true, provider: "paypal", outcome: result.outcome }, "billing webhook");
          const error = result.outcome === "invalid_event" ? "Invalid billing event." : "Invalid billing signature.";
          return reply.code(400).send({ error });
        }
        request.log.info({ billing: true, provider: "paypal", outcome: result.outcome }, "billing webhook");
        return { ok: true as const };
      } catch {
        request.log.info({ billing: true, provider: "paypal", outcome: "retry" }, "billing webhook");
        return reply.code(500).send({ error: "Billing event was not saved." });
      }
    },
  );
}

function paypalHeaders(headers: Record<string, unknown>): Record<string, string | undefined> {
  const read = (name: string) => {
    const value = headers[name];
    if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
    return typeof value === "string" ? value : undefined;
  };
  return {
    "paypal-auth-algo": read("paypal-auth-algo"),
    "paypal-cert-url": read("paypal-cert-url"),
    "paypal-transmission-id": read("paypal-transmission-id"),
    "paypal-transmission-sig": read("paypal-transmission-sig"),
    "paypal-transmission-time": read("paypal-transmission-time"),
  };
}

function isPrismaMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "P2025");
}

function isPrismaConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "P2002");
}

async function resolvePayPalWorkspace(event: PayPalWorkspaceEvent): Promise<PayPalWorkspaceEvent> {
  if (event.type === "ignored" || event.workspaceId || !event.subscriptionId) return event;
  const row = await prisma.workspaceBilling.findFirst({
    where: { provider: "paypal", externalSubscriptionId: event.subscriptionId },
    select: { workspaceId: true },
  });
  if (!row) return event;
  return { ...event, workspaceId: row.workspaceId };
}

async function applyPayPalWorkspaceEvent(
  tx: Prisma.TransactionClient,
  event: PayPalWorkspaceEvent,
): Promise<"applied" | "missing"> {
  if (event.type === "ignored" || !event.workspaceId) return "applied";
  const workspaceId = event.workspaceId;
  try {
    if (event.type === "activated") {
      if (!event.planId || !isPlanId(event.planId)) return "applied";
      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          planId: event.planId,
          billing: {
            upsert: {
              create: {
                provider: "paypal",
                status: "active",
                externalCustomerId: event.customerId,
                externalSubscriptionId: event.subscriptionId,
                seatQuantity: event.seatQuantity,
                pendingPlanId: null,
              },
              update: {
                provider: "paypal",
                status: "active",
                externalCustomerId: event.customerId ?? undefined,
                externalSubscriptionId: event.subscriptionId,
                seatQuantity: event.seatQuantity,
                pendingPlanId: null,
              },
            },
          },
        },
      });
      return "applied";
    }
    if (event.type === "payment_completed") {
      const billing = await tx.workspaceBilling.findUnique({ where: { workspaceId } });
      if (!billing) return "missing";
      const pending = billing.pendingPlanId && isPlanId(billing.pendingPlanId) ? billing.pendingPlanId : null;
      await tx.workspaceBilling.update({
        where: { workspaceId },
        data: {
          provider: "paypal",
          status: "active",
          externalSubscriptionId: event.subscriptionId ?? undefined,
          pendingPlanId: null,
        },
      });
      if (pending) {
        await tx.workspace.update({ where: { id: workspaceId }, data: { planId: pending } });
      }
      return "applied";
    }
    const status = event.type === "canceled"
      ? "canceled"
      : event.type === "suspended"
        ? "suspended"
        : "past_due";
    const updated = await tx.workspaceBilling.updateMany({
      where: { workspaceId },
      data: { provider: "paypal", status },
    });
    return updated.count === 0 ? "missing" : "applied";
  } catch (error) {
    if (isPrismaMissing(error)) return "missing";
    throw error;
  }
}

async function commitPayPalEvent(
  eventId: string,
  eventType: string,
  event: PayPalWorkspaceEvent,
): Promise<"new" | "duplicate" | "missing"> {
  const resolved = await resolvePayPalWorkspace(event);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.billingWebhookEvent.findUnique({ where: { id: eventId } });
      if (existing) return "duplicate";
      const actionable = resolved.type !== "ignored" && Boolean(resolved.workspaceId);
      if (actionable) {
        const applied = await applyPayPalWorkspaceEvent(tx, resolved);
        await tx.billingWebhookEvent.create({
          data: { id: eventId, provider: "paypal", eventType },
        });
        return applied === "missing" ? "missing" : "new";
      }
      await tx.billingWebhookEvent.create({
        data: { id: eventId, provider: "paypal", eventType },
      });
      return resolved.type === "ignored" ? "new" : "missing";
    });
  } catch (error) {
    if (isPrismaConflict(error)) return "duplicate";
    throw error;
  }
}

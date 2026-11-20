import { createHmac, timingSafeEqual } from "node:crypto";
import { createPayPalBilling, type PayPalPlanIds } from "./paypal-billing.js";
import type { PlanId } from "./plans.js";

/**
 * Billing stays off until BILLING_ENABLED=true.
 * The mock adapter never leaves the process. Stripe and PayPal are called
 * only when that provider is selected and its keys are configured.
 * No adapter stores card numbers, access tokens, or client secrets.
 */

export type BillingCheckoutInput = {
  workspaceId: string;
  planId: PlanId;
  seatQuantity: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
};

export type BillingCheckoutResult =
  | {
      ok: true;
      provider: "mock" | "stripe" | "paypal";
      status: "active" | "incomplete";
      checkoutUrl: string | null;
      externalSubscriptionId: string;
    }
  | { ok: false; code: "billing_disabled" | "billing_unconfigured" | "billing_failed"; error: string };

export type BillingConfirmResult =
  | {
      ok: true;
      status: "active" | "incomplete" | "canceled" | "suspended" | "past_due";
      planId: PlanId | null;
      seatQuantity: number;
      externalCustomerId: string | null;
      externalSubscriptionId: string;
      /** True only when the provider itself says the subscription is active. */
      granted: boolean;
    }
  | {
      ok: false;
      code: "billing_disabled" | "billing_unconfigured" | "billing_failed" | "billing_mismatch" | "billing_unsupported";
      error: string;
    };

export type BillingSeatUpdateResult =
  | { ok: true; seatQuantity: number; status: "active" | "incomplete"; checkoutUrl: string | null }
  | { ok: false; code: "billing_disabled" | "billing_unconfigured" | "billing_failed" | "billing_unsupported"; error: string };

export type BillingWebhookCheck = {
  rawBody: string;
  headers: Record<string, string | undefined>;
};

export interface BillingProvider {
  readonly id: "disabled" | "mock" | "stripe" | "paypal";
  createCheckout(input: BillingCheckoutInput): Promise<BillingCheckoutResult>;
  confirmSubscription(input: { subscriptionId: string; workspaceId: string }): Promise<BillingConfirmResult>;
  updateSeatQuantity(input: {
    subscriptionId: string;
    seatQuantity: number;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<BillingSeatUpdateResult>;
  verifyWebhook(input: BillingWebhookCheck): Promise<boolean>;
}

const otherProvider: Pick<BillingProvider, "confirmSubscription" | "updateSeatQuantity" | "verifyWebhook"> = {
  async confirmSubscription() {
    return {
      ok: false,
      code: "billing_unsupported",
      error: "This provider does not confirm PayPal subscriptions.",
    };
  },
  async updateSeatQuantity() {
    return {
      ok: false,
      code: "billing_unsupported",
      error: "This provider does not update PayPal seat quantity.",
    };
  },
  async verifyWebhook() {
    return false;
  },
};

const billingOff = {
  ok: false as const,
  code: "billing_disabled" as const,
  error: "Billing is off. Joining the design-partner list does not charge anyone.",
};

export const disabledBilling: BillingProvider = {
  id: "disabled",
  async createCheckout() {
    return billingOff;
  },
  async confirmSubscription() {
    return billingOff;
  },
  async updateSeatQuantity() {
    return billingOff;
  },
  async verifyWebhook() {
    return false;
  },
};

export function createMockBilling(): BillingProvider {
  let sequence = 0;
  return {
    id: "mock",
    ...otherProvider,
    async createCheckout(input) {
      sequence += 1;
      return {
        ok: true,
        provider: "mock",
        status: "active",
        checkoutUrl: null,
        externalSubscriptionId: `mock_sub_${input.workspaceId}_${sequence}`,
      };
    },
  };
}

export type StripePriceIds = {
  FAMILY_PLUS?: string;
  TEAM?: string;
};

export function stripePriceId(planId: PlanId, prices: StripePriceIds): string | null {
  if (planId === "FAMILY_PLUS") return prices.FAMILY_PLUS ?? null;
  if (planId === "TEAM") return prices.TEAM ?? null;
  return null;
}

export function stripeCheckoutForm(input: BillingCheckoutInput & { priceId: string }): URLSearchParams {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("customer_email", input.customerEmail);
  params.set("client_reference_id", input.workspaceId);
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("line_items[0][price]", input.priceId);
  params.set("line_items[0][quantity]", String(Math.max(1, input.seatQuantity)));
  params.set("metadata[workspaceId]", input.workspaceId);
  params.set("metadata[planId]", input.planId);
  return params;
}

export function createStripeBilling(options: {
  secretKey?: string;
  prices: StripePriceIds;
  fetchImpl?: typeof fetch;
}): BillingProvider {
  return {
    id: "stripe",
    ...otherProvider,
    async createCheckout(input) {
      const priceId = stripePriceId(input.planId, options.prices);
      if (!options.secretKey || !priceId) {
        return {
          ok: false,
          code: "billing_unconfigured",
          error: "Stripe is not configured. No charge was attempted.",
        };
      }
      const fetchImpl = options.fetchImpl;
      if (!fetchImpl) {
        return {
          ok: false,
          code: "billing_unconfigured",
          error: "Stripe is not configured. No charge was attempted.",
        };
      }
      const body = stripeCheckoutForm({ ...input, priceId });
      let response: Response;
      try {
        response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        });
      } catch {
        return { ok: false, code: "billing_failed", error: "Stripe could not be reached. No charge was confirmed." };
      }
      const payload = await response.json().catch(() => null) as { id?: string; url?: string } | null;
      if (!response.ok || !payload?.id) {
        return { ok: false, code: "billing_failed", error: "Stripe did not open a checkout. No charge was confirmed." };
      }
      return {
        ok: true,
        provider: "stripe",
        status: "incomplete",
        checkoutUrl: typeof payload.url === "string" ? payload.url : null,
        externalSubscriptionId: payload.id,
      };
    },
  };
}

export function selectBillingProvider(config: {
  enabled: boolean;
  provider: "mock" | "stripe" | "paypal";
  stripeSecretKey?: string;
  prices: StripePriceIds;
  paypal?: {
    clientId?: string;
    clientSecret?: string;
    environment?: "sandbox" | "live";
    webhookId?: string;
    plans?: PayPalPlanIds;
  };
  fetchImpl?: typeof fetch;
}): BillingProvider {
  if (!config.enabled) return disabledBilling;
  if (config.provider === "mock") return createMockBilling();
  if (config.provider === "stripe") {
    return createStripeBilling({
      secretKey: config.stripeSecretKey,
      prices: config.prices,
      fetchImpl: config.fetchImpl,
    });
  }
  return createPayPalBilling({
    clientId: config.paypal?.clientId,
    clientSecret: config.paypal?.clientSecret,
    environment: config.paypal?.environment,
    webhookId: config.paypal?.webhookId,
    plans: config.paypal?.plans ?? {},
    fetchImpl: config.fetchImpl,
  });
}

const signatureToleranceSec = 300;

/** Stripe-Signature over the raw body. Returns false on any mismatch. */
export function verifyStripeSignature(input: {
  rawBody: string;
  header: string | undefined;
  secret: string;
  nowSec: number;
}): boolean {
  if (!input.secret || !input.header) return false;
  const parts = new Map<string, string[]>();
  for (const piece of input.header.split(",")) {
    const [key, value] = piece.split("=", 2);
    if (!key || !value) continue;
    const list = parts.get(key) ?? [];
    list.push(value);
    parts.set(key, list);
  }
  const timestamp = parts.get("t")?.[0];
  const signatures = parts.get("v1") ?? [];
  if (!timestamp || signatures.length === 0) return false;
  const stamp = Number(timestamp);
  if (!Number.isFinite(stamp) || Math.abs(input.nowSec - stamp) > signatureToleranceSec) return false;
  const expected = createHmac("sha256", input.secret).update(`${timestamp}.${input.rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  return signatures.some((signature) => {
    const actual = Buffer.from(signature, "utf8");
    return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
  });
}

export type StripeWorkspaceEvent =
  | { type: "activated"; workspaceId: string; planId: string; customerId: string | null; subscriptionId: string | null }
  | { type: "canceled"; workspaceId: string }
  | { type: "ignored" };

export function interpretStripeEvent(payload: unknown): StripeWorkspaceEvent {
  if (!payload || typeof payload !== "object") return { type: "ignored" };
  const event = payload as { type?: unknown; data?: { object?: unknown } };
  const object = event.data?.object;
  if (!object || typeof object !== "object") return { type: "ignored" };
  const record = object as {
    metadata?: { workspaceId?: unknown; planId?: unknown };
    client_reference_id?: unknown;
    customer?: unknown;
    subscription?: unknown;
    id?: unknown;
  };
  const workspaceId = typeof record.metadata?.workspaceId === "string"
    ? record.metadata.workspaceId
    : typeof record.client_reference_id === "string"
      ? record.client_reference_id
      : null;
  if (!workspaceId) return { type: "ignored" };
  if (event.type === "checkout.session.completed") {
    const planId = typeof record.metadata?.planId === "string" ? record.metadata.planId : "";
    return {
      type: "activated",
      workspaceId,
      planId,
      customerId: typeof record.customer === "string" ? record.customer : null,
      subscriptionId: typeof record.subscription === "string" ? record.subscription : null,
    };
  }
  if (event.type === "customer.subscription.deleted") {
    return { type: "canceled", workspaceId };
  }
  return { type: "ignored" };
}

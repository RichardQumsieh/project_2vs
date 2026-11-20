import { createHash, randomUUID } from "node:crypto";
import type {
  BillingConfirmResult,
  BillingProvider,
  BillingWebhookCheck,
} from "./billing.js";
import type { PlanId } from "./plans.js";

/**
 * PayPal Subscriptions (REST v1). OAuth uses the client secret once, then a
 * bearer token. Tokens and secrets are not returned to the browser and are
 * not written to logs by this module. The buyer approves on PayPal. This
 * server grants a plan only after PayPal says the subscription is ACTIVE.
 */

export type PayPalPlanIds = {
  FAMILY_PLUS?: string;
  TEAM?: string;
};

export type PayPalWorkspaceEvent =
  | {
      type: "activated";
      workspaceId: string | null;
      subscriptionId: string;
      planId: PlanId | null;
      seatQuantity: number;
      customerId: string | null;
    }
  | {
      type: "canceled" | "suspended" | "payment_failed" | "payment_completed";
      workspaceId: string | null;
      subscriptionId: string | null;
    }
  | { type: "ignored" };

const approvalHosts = new Set([
  "www.paypal.com",
  "www.sandbox.paypal.com",
  "paypal.com",
  "sandbox.paypal.com",
]);

const certHosts = new Set([
  "api.paypal.com",
  "api.sandbox.paypal.com",
  "api-m.paypal.com",
  "api-m.sandbox.paypal.com",
]);

const transmissionToleranceMs = 10 * 60 * 1000;

const eventMap = {
  "BILLING.SUBSCRIPTION.ACTIVATED": "activated",
  "BILLING.SUBSCRIPTION.CANCELLED": "canceled",
  "BILLING.SUBSCRIPTION.SUSPENDED": "suspended",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED": "payment_failed",
  "PAYMENT.SALE.COMPLETED": "payment_completed",
} as const;

export function paypalApiBase(environment: "sandbox" | "live" | undefined): string {
  return environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export function paypalPlanIdFor(planId: PlanId, plans: PayPalPlanIds): string | null {
  if (planId === "FAMILY_PLUS") return plans.FAMILY_PLUS ?? null;
  if (planId === "TEAM") return plans.TEAM ?? null;
  return null;
}

export function planIdFromPayPalPlan(planId: string, plans: PayPalPlanIds): PlanId | null {
  if (plans.FAMILY_PLUS && planId === plans.FAMILY_PLUS) return "FAMILY_PLUS";
  if (plans.TEAM && planId === plans.TEAM) return "TEAM";
  return null;
}

export function clampSeatQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(50, Math.max(1, Math.floor(value)));
}

export function paypalSubscriptionId(value: string): string | null {
  if (!/^[A-Za-z0-9-]{3,50}$/.test(value)) return null;
  return value;
}

export function paypalApprovalHost(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "https:" && approvalHosts.has(url.hostname);
  } catch {
    return false;
  }
}

export function paypalApprovalUrl(links: unknown): string | null {
  if (!Array.isArray(links)) return null;
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const record = link as { rel?: unknown; href?: unknown };
    if (record.rel !== "approve" || typeof record.href !== "string") continue;
    if (paypalApprovalHost(record.href)) return record.href;
  }
  return null;
}

/** PayPal's verify API is the only place a cert URL is sent. It must be PayPal's. */
export function paypalCertUrlAllowed(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password || url.search || url.hash) return false;
    if (!certHosts.has(url.hostname)) return false;
    return url.pathname.startsWith("/v1/notifications/certs/");
  } catch {
    return false;
  }
}

export function paypalTransmissionFresh(value: string, nowMs: number): boolean {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return false;
  return Math.abs(nowMs - stamp) <= transmissionToleranceMs;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function readQuantity(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) return 1;
  return parsed;
}

function paypalBillingStatus(status: string | null): "active" | "incomplete" | "canceled" | "suspended" | null {
  if (status === "ACTIVE") return "active";
  if (status === "APPROVAL_PENDING" || status === "APPROVED") return "incomplete";
  if (status === "CANCELLED" || status === "EXPIRED") return "canceled";
  if (status === "SUSPENDED") return "suspended";
  return null;
}

export function readPayPalEventId(payload: unknown): string | null {
  const record = asRecord(payload);
  const id = record ? readString(record.id, 128) : null;
  if (!id || !/^[A-Za-z0-9._:-]{8,128}$/.test(id)) return null;
  return id;
}

export function readPayPalEventType(payload: unknown): string | null {
  const record = asRecord(payload);
  const type = record ? readString(record.event_type, 80) : null;
  if (!type || !/^[A-Z0-9._]+$/.test(type)) return null;
  return type;
}

/**
 * Reads a PayPal subscription resource. `granted` is true only for ACTIVE
 * with a plan id this server sells and a custom id for this workspace.
 * APPROVED is not enough: the buyer has returned, but PayPal has not activated.
 */
export function interpretPayPalSubscription(payload: unknown, options: {
  plans: PayPalPlanIds;
  workspaceId: string;
  subscriptionId: string;
}): BillingConfirmResult {
  const record = asRecord(payload);
  if (!record) {
    return { ok: false, code: "billing_failed", error: "PayPal did not return this subscription." };
  }
  const id = readString(record.id, 50);
  if (!id || id !== options.subscriptionId || !paypalSubscriptionId(id)) {
    return { ok: false, code: "billing_mismatch", error: "PayPal returned a different subscription." };
  }
  const customId = readString(record.custom_id, 80);
  if (!customId || customId !== options.workspaceId) {
    return { ok: false, code: "billing_mismatch", error: "This subscription does not belong to the workspace." };
  }
  const paypalPlan = readString(record.plan_id, 80);
  const planId = paypalPlan ? planIdFromPayPalPlan(paypalPlan, options.plans) : null;
  const seatQuantity = readQuantity(record.quantity);
  const subscriber = asRecord(record.subscriber);
  const customerId = subscriber ? readString(subscriber.payer_id, 64) : null;
  const billingStatus = paypalBillingStatus(readString(record.status, 40));
  if (billingStatus === "active") {
    if (!planId) {
      return { ok: false, code: "billing_mismatch", error: "PayPal confirmed a plan this server does not sell." };
    }
    return {
      ok: true,
      status: "active",
      planId,
      seatQuantity,
      externalCustomerId: customerId,
      externalSubscriptionId: id,
      granted: true,
    };
  }
  if (!billingStatus) {
    return { ok: false, code: "billing_failed", error: "PayPal returned a status this server does not use." };
  }
  return {
    ok: true,
    status: billingStatus,
    planId: null,
    seatQuantity,
    externalCustomerId: customerId,
    externalSubscriptionId: id,
    granted: false,
  };
}

export function interpretPayPalEvent(payload: unknown, plans: PayPalPlanIds): PayPalWorkspaceEvent {
  const record = asRecord(payload);
  if (!record) return { type: "ignored" };
  const eventType = readString(record.event_type, 80);
  const kind = eventType ? eventMap[eventType as keyof typeof eventMap] : undefined;
  if (!kind) return { type: "ignored" };
  const resource = asRecord(record.resource);
  if (!resource) return { type: "ignored" };
  if (kind === "payment_completed") {
    const subscriptionId = paypalSubscriptionId(readString(resource.billing_agreement_id, 50) ?? "");
    const workspaceId = readString(resource.custom, 80) ?? readString(resource.custom_id, 80);
    return { type: "payment_completed", workspaceId, subscriptionId };
  }
  const subscriptionId = paypalSubscriptionId(readString(resource.id, 50) ?? "");
  const workspaceId = readString(resource.custom_id, 80);
  if (kind === "activated") {
    if (!subscriptionId) return { type: "ignored" };
    const paypalPlan = readString(resource.plan_id, 80);
    const planId = paypalPlan ? planIdFromPayPalPlan(paypalPlan, plans) : null;
    if (!planId) return { type: "ignored" };
    const subscriber = asRecord(resource.subscriber);
    return {
      type: "activated",
      workspaceId,
      subscriptionId,
      planId,
      seatQuantity: readQuantity(resource.quantity),
      customerId: subscriber ? readString(subscriber.payer_id, 64) : null,
    };
  }
  return { type: kind, workspaceId, subscriptionId };
}

export async function verifyPayPalWebhook(input: {
  apiBase: string;
  accessToken: string;
  webhookId: string;
  headers: Record<string, string | undefined>;
  event: unknown;
  fetchImpl: typeof fetch;
  nowMs: number;
}): Promise<boolean> {
  if (!input.webhookId || !input.accessToken) return false;
  const authAlgo = input.headers["paypal-auth-algo"];
  const certUrl = input.headers["paypal-cert-url"];
  const transmissionId = input.headers["paypal-transmission-id"];
  const transmissionSig = input.headers["paypal-transmission-sig"];
  const transmissionTime = input.headers["paypal-transmission-time"];
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) return false;
  if (!paypalCertUrlAllowed(certUrl) || !paypalTransmissionFresh(transmissionTime, input.nowMs)) return false;
  let response: Response;
  try {
    response = await input.fetchImpl(`${input.apiBase}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: input.webhookId,
        webhook_event: input.event,
      }),
    });
  } catch {
    return false;
  }
  if (response.status < 200 || response.status >= 300) return false;
  const payload = await response.json().catch(() => null) as { verification_status?: unknown } | null;
  return payload?.verification_status === "SUCCESS";
}

export async function processPayPalWebhook(input: {
  rawBody: string;
  headers: Record<string, string | undefined>;
  plans: PayPalPlanIds;
  verify: (headers: Record<string, string | undefined>, rawBody: string) => Promise<boolean>;
  commit: (
    eventId: string,
    eventType: string,
    event: PayPalWorkspaceEvent,
  ) => Promise<"new" | "duplicate" | "missing">;
}): Promise<{ httpStatus: 200 | 400; outcome: string }> {
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { httpStatus: 400, outcome: "invalid_event" };
  }
  const verified = await input.verify(input.headers, input.rawBody);
  if (!verified) return { httpStatus: 400, outcome: "invalid_signature" };
  const eventId = readPayPalEventId(payload);
  if (!eventId) return { httpStatus: 400, outcome: "invalid_event" };
  const event = interpretPayPalEvent(payload, input.plans);
  const eventType = readPayPalEventType(payload) ?? "unknown";
  const result = await input.commit(eventId, eventType, event);
  if (result === "duplicate") return { httpStatus: 200, outcome: "duplicate" };
  if (result === "missing") return { httpStatus: 200, outcome: "ignored" };
  return { httpStatus: 200, outcome: event.type === "ignored" ? "ignored" : event.type };
}

const unconfigured = {
  ok: false as const,
  code: "billing_unconfigured" as const,
  error: "PayPal is not configured. No charge was attempted.",
};

const failed = {
  ok: false as const,
  code: "billing_failed" as const,
  error: "PayPal could not be reached. No charge was confirmed.",
};

export function createPayPalBilling(options: {
  clientId?: string;
  clientSecret?: string;
  environment?: "sandbox" | "live";
  webhookId?: string;
  plans: PayPalPlanIds;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): BillingProvider {
  const apiBase = paypalApiBase(options.environment);
  let cached: { token: string; expiresAtMs: number } | null = null;

  async function accessToken(): Promise<
    | { ok: true; token: string }
    | { ok: false; code: "billing_unconfigured" | "billing_failed"; error: string }
  > {
    if (!options.clientId || !options.clientSecret || !options.fetchImpl) return unconfigured;
    const now = options.now?.() ?? Date.now();
    if (cached && cached.expiresAtMs > now) return { ok: true, token: cached.token };
    const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`, "utf8").toString("base64");
    let response: Response;
    try {
      response = await options.fetchImpl(`${apiBase}/v1/oauth2/token`, {
        method: "POST",
        redirect: "manual",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
      });
    } catch {
      return failed;
    }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, code: "billing_failed", error: "PayPal did not authorize this server. No charge was confirmed." };
    }
    const payload = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
    const token = payload && typeof payload.access_token === "string" ? payload.access_token : "";
    const expiresIn = Number(payload?.expires_in);
    if (!token || !Number.isFinite(expiresIn) || expiresIn < 30) {
      return { ok: false, code: "billing_failed", error: "PayPal did not authorize this server. No charge was confirmed." };
    }
    cached = { token, expiresAtMs: now + Math.max(30, expiresIn - 60) * 1000 };
    return { ok: true, token };
  }

  async function paypalJson(path: string, init: { method: string; body?: string; requestId?: string }): Promise<
    | { ok: true; status: number; json: unknown }
    | { ok: false; code: "billing_unconfigured" | "billing_failed"; error: string }
  > {
    const token = await accessToken();
    if (!token.ok) return token;
    const fetchImpl = options.fetchImpl;
    if (!fetchImpl) return unconfigured;
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method: init.method,
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${token.token}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
        },
        body: init.body,
      });
    } catch {
      return failed;
    }
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, code: "billing_failed", error: "PayPal did not accept this billing change. No charge was confirmed." };
    }
    if (response.status === 204) return { ok: true, status: 204, json: null };
    const json = await response.json().catch(() => null);
    return { ok: true, status: response.status, json };
  }

  return {
    id: "paypal",
    async createCheckout(input) {
      const plan = paypalPlanIdFor(input.planId, options.plans);
      if (!options.clientId || !options.clientSecret || !plan || !options.fetchImpl) return unconfigured;
      const quantity = input.planId === "TEAM" ? clampSeatQuantity(input.seatQuantity) : 1;
      const body: Record<string, unknown> = {
        plan_id: plan,
        quantity: String(quantity),
        custom_id: input.workspaceId,
        application_context: {
          brand_name: "Sophia",
          shipping_preference: "NO_SHIPPING",
          user_action: "SUBSCRIBE_NOW",
          return_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
      };
      if (input.customerEmail.includes("@")) {
        body.subscriber = { email_address: input.customerEmail };
      }
      const created = await paypalJson("/v1/billing/subscriptions", {
        method: "POST",
        body: JSON.stringify(body),
        requestId: randomUUID(),
      });
      if (!created.ok) return created;
      const record = asRecord(created.json);
      const id = record ? paypalSubscriptionId(readString(record.id, 50) ?? "") : null;
      const approval = record ? paypalApprovalUrl(record.links) : null;
      if (!id || !approval) {
        return { ok: false, code: "billing_failed", error: "PayPal did not open a checkout. No charge was confirmed." };
      }
      return {
        ok: true,
        provider: "paypal",
        status: "incomplete",
        checkoutUrl: approval,
        externalSubscriptionId: id,
      };
    },
    async confirmSubscription(input) {
      const subscriptionId = paypalSubscriptionId(input.subscriptionId);
      if (!subscriptionId) {
        return { ok: false, code: "billing_mismatch", error: "This return does not match a checkout we started." };
      }
      if (!options.clientId || !options.clientSecret || !options.fetchImpl) return unconfigured;
      const loaded = await paypalJson(`/v1/billing/subscriptions/${subscriptionId}`, { method: "GET" });
      if (!loaded.ok) return loaded;
      return interpretPayPalSubscription(loaded.json, {
        plans: options.plans,
        workspaceId: input.workspaceId,
        subscriptionId,
      });
    },
    async updateSeatQuantity(input) {
      const subscriptionId = paypalSubscriptionId(input.subscriptionId);
      const quantity = clampSeatQuantity(input.seatQuantity);
      if (!subscriptionId) {
        return { ok: false, code: "billing_failed", error: "PayPal did not accept this billing change. No charge was confirmed." };
      }
      if (!options.clientId || !options.clientSecret || !options.fetchImpl) return unconfigured;
      const revised = await paypalJson(`/v1/billing/subscriptions/${subscriptionId}/revise`, {
        method: "POST",
        requestId: createHash("sha256").update(`seats:${subscriptionId}:${quantity}`).digest("hex").slice(0, 32),
        body: JSON.stringify({
          quantity: String(quantity),
          application_context: {
            brand_name: "Sophia",
            shipping_preference: "NO_SHIPPING",
            user_action: "SUBSCRIBE_NOW",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        }),
      });
      if (!revised.ok) return revised;
      const record = asRecord(revised.json);
      const approval = record ? paypalApprovalUrl(record.links) : null;
      if (approval) {
        return { ok: true, seatQuantity: quantity, status: "incomplete", checkoutUrl: approval };
      }
      return { ok: true, seatQuantity: quantity, status: "active", checkoutUrl: null };
    },
    async verifyWebhook(input: BillingWebhookCheck) {
      const certUrl = input.headers["paypal-cert-url"];
      const transmissionTime = input.headers["paypal-transmission-time"];
      const nowMs = options.now?.() ?? Date.now();
      if (!options.webhookId || !options.fetchImpl || !certUrl || !paypalCertUrlAllowed(certUrl)) return false;
      if (!transmissionTime || !paypalTransmissionFresh(transmissionTime, nowMs)) return false;
      let event: unknown;
      try {
        event = JSON.parse(input.rawBody);
      } catch {
        return false;
      }
      const token = await accessToken();
      if (!token.ok) return false;
      return verifyPayPalWebhook({
        apiBase,
        accessToken: token.token,
        webhookId: options.webhookId,
        headers: input.headers,
        event,
        fetchImpl: options.fetchImpl,
        nowMs,
      });
    },
  };
}

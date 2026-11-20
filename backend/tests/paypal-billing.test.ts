import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectBillingProvider } from "../src/billing.js";
import { sanitizeLogArgs } from "../src/log-redaction.js";
import {
  createPayPalBilling,
  interpretPayPalEvent,
  interpretPayPalSubscription,
  paypalCertUrlAllowed,
  processPayPalWebhook,
  verifyPayPalWebhook,
} from "../src/paypal-billing.js";

const secret = "ECl-client-secret-value-long";
const clientId = "AY-client-id-value-long";
const accessToken = "A21AA-access-token-value-long";
const plans = { FAMILY_PLUS: "P-FAMILY", TEAM: "P-TEAM" };
const approval = "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-TEST";

type Seen = { url: string; auth: string; body: string; method: string };

function scriptedFetch(queue: Array<{ status: number; json?: unknown }>, seen: Seen[]): typeof fetch {
  return async (url, init) => {
    seen.push({
      url: String(url),
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("Authorization") ?? "",
      body: typeof init?.body === "string" ? init.body : "",
    });
    const step = queue.shift();
    if (!step) return new Response("missing", { status: 500 });
    if (step.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(step.json ?? {}), {
      status: step.status,
      headers: { "content-type": "application/json" },
    });
  };
}

const checkoutInput = {
  workspaceId: "ws-1",
  planId: "TEAM" as const,
  seatQuantity: 4,
  customerEmail: "ada@example.com",
  successUrl: "https://sophia.example/billing/paypal/return?workspace=ws-1",
  cancelUrl: "https://sophia.example/billing/paypal/cancel?workspace=ws-1",
};

describe("PayPal billing adapter", () => {
  it("stays on the mock adapter when billing is off, including when PayPal is selected", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error("network");
    };
    const disabled = selectBillingProvider({
      enabled: false,
      provider: "paypal",
      paypal: { clientId, clientSecret: secret, plans },
      prices: {},
      fetchImpl,
    });
    assert.equal(disabled.id, "disabled");
    const off = await disabled.createCheckout(checkoutInput);
    assert.equal(off.ok, false);
    if (!off.ok) assert.equal(off.code, "billing_disabled");
    const stripe = selectBillingProvider({
      enabled: true,
      provider: "stripe",
      stripeSecretKey: "sk_test_example",
      prices: { TEAM: "price_team" },
      fetchImpl,
    });
    assert.equal(stripe.id, "stripe");
    assert.equal(calls, 0);
  });

  it("does not call PayPal until the client id, secret, and plan id are set", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error("network");
    };
    const result = await createPayPalBilling({ plans: {}, fetchImpl }).createCheckout(checkoutInput);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "billing_unconfigured");
    assert.equal(calls, 0);
  });

  it("creates a subscription with OAuth and returns only a PayPal approval URL", async () => {
    const seen: Seen[] = [];
    const fetchImpl = scriptedFetch([
      { status: 200, json: { access_token: accessToken, expires_in: 300 } },
      {
        status: 201,
        json: {
          id: "I-SUB123",
          status: "APPROVAL_PENDING",
          links: [{ href: approval, rel: "approve", method: "GET" }],
        },
      },
    ], seen);
    const result = await createPayPalBilling({
      clientId,
      clientSecret: secret,
      environment: "sandbox",
      plans,
      fetchImpl,
    }).createCheckout(checkoutInput);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.provider, "paypal");
      assert.equal(result.status, "incomplete");
      assert.equal(result.checkoutUrl, approval);
      assert.equal(result.externalSubscriptionId, "I-SUB123");
    }
    assert.equal(seen[0]?.url, "https://api-m.sandbox.paypal.com/v1/oauth2/token");
    assert.equal(seen[0]?.body, "grant_type=client_credentials");
    assert.equal(seen[0]?.body.includes(secret), false);
    assert.equal(seen[1]?.url, "https://api-m.sandbox.paypal.com/v1/billing/subscriptions");
    assert.equal(seen[1]?.auth, `Bearer ${accessToken}`);
    assert.equal(seen[1]?.body.includes(secret), false);
    assert.equal(seen[1]?.body.includes(accessToken), false);
    const body = JSON.parse(seen[1]?.body ?? "{}") as { plan_id: string; quantity: string; custom_id: string };
    assert.equal(body.plan_id, "P-TEAM");
    assert.equal(body.quantity, "4");
    assert.equal(body.custom_id, "ws-1");
  });

  it("bills Family Plus as quantity 1 and rejects a non-PayPal approval link", async () => {
    const seen: Seen[] = [];
    const fetchImpl = scriptedFetch([
      { status: 200, json: { access_token: accessToken, expires_in: 300 } },
      {
        status: 201,
        json: {
          id: "I-PLUS",
          links: [{ href: "https://evil.example/approve", rel: "approve" }],
        },
      },
    ], seen);
    const result = await createPayPalBilling({
      clientId,
      clientSecret: secret,
      plans,
      fetchImpl,
    }).createCheckout({ ...checkoutInput, planId: "FAMILY_PLUS", seatQuantity: 12 });
    assert.equal(result.ok, false);
    const body = JSON.parse(seen[1]?.body ?? "{}") as { quantity: string; plan_id: string };
    assert.equal(body.plan_id, "P-FAMILY");
    assert.equal(body.quantity, "1");
  });

  it("updates Team seat quantity on the existing subscription", async () => {
    const seen: Seen[] = [];
    const fetchImpl = scriptedFetch([
      { status: 200, json: { access_token: accessToken, expires_in: 300 } },
      { status: 204 },
    ], seen);
    const result = await createPayPalBilling({
      clientId,
      clientSecret: secret,
      plans,
      fetchImpl,
    }).updateSeatQuantity({
      subscriptionId: "I-SUB123",
      seatQuantity: 6,
      returnUrl: checkoutInput.successUrl,
      cancelUrl: checkoutInput.cancelUrl,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "active");
      assert.equal(result.seatQuantity, 6);
      assert.equal(result.checkoutUrl, null);
    }
    assert.equal(seen[1]?.method, "POST");
    assert.equal(seen[1]?.url, "https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-SUB123/revise");
    const body = JSON.parse(seen[1]?.body ?? "{}") as { quantity: string };
    assert.equal(body.quantity, "6");
    assert.equal(seen[1]?.body.includes(secret), false);
  });

  it("grants a plan only when PayPal reports the subscription active for this workspace", async () => {
    const active = {
      id: "I-SUB123",
      status: "ACTIVE",
      plan_id: "P-FAMILY",
      custom_id: "ws-1",
      quantity: "1",
      subscriber: { payer_id: "PAYER1", email_address: "ada@example.com" },
    };
    const granted = interpretPayPalSubscription(active, {
      plans,
      workspaceId: "ws-1",
      subscriptionId: "I-SUB123",
    });
    assert.equal(granted.ok, true);
    if (granted.ok) {
      assert.equal(granted.granted, true);
      assert.equal(granted.planId, "FAMILY_PLUS");
      assert.equal(granted.externalCustomerId, "PAYER1");
    }
    const approved = interpretPayPalSubscription({ ...active, status: "APPROVED" }, {
      plans,
      workspaceId: "ws-1",
      subscriptionId: "I-SUB123",
    });
    assert.equal(approved.ok, true);
    if (approved.ok) {
      assert.equal(approved.granted, false);
      assert.equal(approved.status, "incomplete");
      assert.equal(approved.planId, null);
    }
    const otherWorkspace = interpretPayPalSubscription(active, {
      plans,
      workspaceId: "ws-2",
      subscriptionId: "I-SUB123",
    });
    assert.equal(otherWorkspace.ok, false);
    if (!otherWorkspace.ok) assert.equal(otherWorkspace.code, "billing_mismatch");

    const seen: Seen[] = [];
    const fetchImpl = scriptedFetch([
      { status: 200, json: { access_token: accessToken, expires_in: 300 } },
      { status: 200, json: active },
    ], seen);
    const confirmed = await createPayPalBilling({
      clientId,
      clientSecret: secret,
      plans,
      fetchImpl,
    }).confirmSubscription({ subscriptionId: "I-SUB123", workspaceId: "ws-1" });
    assert.equal(confirmed.ok, true);
    if (confirmed.ok) assert.equal(confirmed.granted, true);
    assert.equal(seen[1]?.method, "GET");
    assert.equal(seen[1]?.url, "https://api-m.sandbox.paypal.com/v1/billing/subscriptions/I-SUB123");
    assert.equal(seen[1]?.body.includes(secret), false);
  });
});

describe("PayPal webhooks", () => {
  const nowMs = Date.parse("2026-11-20T22:00:00.000Z");
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "trans-1",
    "paypal-transmission-sig": "sig-value-long-enough",
    "paypal-transmission-time": "2026-11-20T22:00:00.000Z",
  };
  const event = {
    id: "WH-EVENT-1234",
    event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
    resource: {
      id: "I-SUB123",
      custom_id: "ws-1",
      plan_id: "P-TEAM",
      quantity: "4",
      status: "ACTIVE",
      subscriber: { payer_id: "PAYER1" },
    },
  };

  it("verifies the signature with PayPal and refuses a foreign cert URL without a network call", async () => {
    assert.equal(paypalCertUrlAllowed("https://evil.example/v1/notifications/certs/CERT-1"), false);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error("network");
    };
    const blocked = await verifyPayPalWebhook({
      apiBase: "https://api-m.sandbox.paypal.com",
      accessToken,
      webhookId: "WH-ID",
      headers: { ...headers, "paypal-cert-url": "https://evil.example/v1/notifications/certs/CERT-1" },
      event,
      fetchImpl,
      nowMs,
    });
    assert.equal(blocked, false);
    assert.equal(calls, 0);
    const stale = await verifyPayPalWebhook({
      apiBase: "https://api-m.sandbox.paypal.com",
      accessToken,
      webhookId: "WH-ID",
      headers: { ...headers, "paypal-transmission-time": "2026-11-20T21:00:00.000Z" },
      event,
      fetchImpl,
      nowMs,
    });
    assert.equal(stale, false);
    assert.equal(calls, 0);

    const seen: Seen[] = [];
    const ok = await verifyPayPalWebhook({
      apiBase: "https://api-m.sandbox.paypal.com",
      accessToken,
      webhookId: "WH-ID",
      headers,
      event,
      fetchImpl: scriptedFetch([{ status: 200, json: { verification_status: "SUCCESS" } }], seen),
      nowMs,
    });
    assert.equal(ok, true);
    assert.equal(seen[0]?.url, "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    assert.equal(seen[0]?.auth, `Bearer ${accessToken}`);
    assert.equal(seen[0]?.body.includes(secret), false);
    const sent = JSON.parse(seen[0]?.body ?? "{}") as { webhook_id: string; webhook_event: { id: string } };
    assert.equal(sent.webhook_id, "WH-ID");
    assert.equal(sent.webhook_event.id, "WH-EVENT-1234");
    const failed = await verifyPayPalWebhook({
      apiBase: "https://api-m.sandbox.paypal.com",
      accessToken,
      webhookId: "WH-ID",
      headers,
      event,
      fetchImpl: scriptedFetch([{ status: 200, json: { verification_status: "FAILURE" } }], []),
      nowMs,
    });
    assert.equal(failed, false);
  });

  it("maps subscription and payment events and applies each event id once", async () => {
    const activated = interpretPayPalEvent(event, plans);
    assert.equal(activated.type, "activated");
    if (activated.type === "activated") {
      assert.equal(activated.workspaceId, "ws-1");
      assert.equal(activated.planId, "TEAM");
      assert.equal(activated.seatQuantity, 4);
    }
    assert.equal(interpretPayPalEvent({
      id: "WH-CANCEL-1",
      event_type: "BILLING.SUBSCRIPTION.CANCELLED",
      resource: { id: "I-SUB123", custom_id: "ws-1" },
    }, plans).type, "canceled");
    assert.equal(interpretPayPalEvent({
      id: "WH-SUSPEND-1",
      event_type: "BILLING.SUBSCRIPTION.SUSPENDED",
      resource: { id: "I-SUB123", custom_id: "ws-1" },
    }, plans).type, "suspended");
    assert.equal(interpretPayPalEvent({
      id: "WH-FAIL-1",
      event_type: "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
      resource: { id: "I-SUB123", custom_id: "ws-1" },
    }, plans).type, "payment_failed");
    const paid = interpretPayPalEvent({
      id: "WH-SALE-1",
      event_type: "PAYMENT.SALE.COMPLETED",
      resource: { id: "SALE1", billing_agreement_id: "I-SUB123", custom: "ws-1", state: "completed" },
    }, plans);
    assert.equal(paid.type, "payment_completed");
    if (paid.type === "payment_completed") assert.equal(paid.subscriptionId, "I-SUB123");
    assert.equal(interpretPayPalEvent({
      id: "WH-OTHER-1",
      event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
      resource: { id: "I-SUB123", custom_id: "ws-1", plan_id: "P-UNKNOWN" },
    }, plans).type, "ignored");

    const applied: string[] = [];
    const seen = new Set<string>();
    const raw = JSON.stringify(event);
    const run = () => processPayPalWebhook({
      rawBody: raw,
      headers,
      plans,
      verify: async () => true,
      commit: async (id, _type, webhookEvent) => {
        if (seen.has(id)) return "duplicate";
        seen.add(id);
        applied.push(webhookEvent.type);
        return "new";
      },
    });
    const first = await run();
    const second = await run();
    assert.equal(first.outcome, "activated");
    assert.equal(second.outcome, "duplicate");
    assert.deepEqual(applied, ["activated"]);

    let commits = 0;
    const rejected = await processPayPalWebhook({
      rawBody: raw,
      headers,
      plans,
      verify: async () => false,
      commit: async () => {
        commits += 1;
        return "new";
      },
    });
    assert.equal(rejected.httpStatus, 400);
    assert.equal(commits, 0);
  });

  it("redacts PayPal tokens and secrets from logs", () => {
    const args = sanitizeLogArgs([
      {
        access_token: accessToken,
        client_secret: secret,
        transmission_sig: "sig-value-long-enough",
        cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      },
      `Authorization: Bearer ${accessToken}`,
    ]);
    const text = JSON.stringify(args);
    assert.equal(text.includes(accessToken), false);
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes("sig-value-long-enough"), false);
    assert.match(text, /\[redacted\]/);
  });
});

/**
 * The browser return from PayPal is not a grant. The page sends the
 * subscription id to the API, and only a server response with granted=true
 * and status=active changes what the person sees as an active plan.
 */

const approvalHosts = new Set([
  "www.paypal.com",
  "www.sandbox.paypal.com",
  "paypal.com",
  "sandbox.paypal.com",
]);

export type PayPalReturnPhase =
  | "checking"
  | "active"
  | "pending"
  | "canceled"
  | "suspended"
  | "pastDue"
  | "failed"
  | "missing";

export function readPayPalReturn(search: string): { workspaceId: string; subscriptionId: string } | null {
  const params = new URLSearchParams(search);
  const workspaceId = params.get("workspace")?.trim() ?? "";
  const subscriptionId = params.get("subscription_id")?.trim() ?? "";
  if (!/^[A-Za-z0-9-]{4,80}$/.test(workspaceId)) return null;
  if (!/^[A-Za-z0-9-]{3,50}$/.test(subscriptionId)) return null;
  return { workspaceId, subscriptionId };
}

export function phaseFromConfirm(result: { granted: boolean; status: string }): PayPalReturnPhase {
  if (result.granted && result.status === "active") return "active";
  if (result.status === "canceled") return "canceled";
  if (result.status === "suspended") return "suspended";
  if (result.status === "past_due") return "pastDue";
  if (result.status === "incomplete" || result.status === "active") return "pending";
  return "failed";
}

/** A query string, even one that says ACTIVE, never grants the plan. */
export function returnGrantsPlan(input: { queryStatus: string | null; serverGranted: boolean; serverStatus: string }): boolean {
  return input.serverGranted && input.serverStatus === "active";
}

export function isBillingCheckoutUrl(value: string | null | undefined, provider: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (provider === "paypal") return approvalHosts.has(url.hostname);
    if (provider === "stripe") return url.hostname === "checkout.stripe.com";
    return false;
  } catch {
    return false;
  }
}

export function isPayPalApprovalUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && approvalHosts.has(url.hostname);
  } catch {
    return false;
  }
}

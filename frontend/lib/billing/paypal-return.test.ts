import { describe, expect, it } from "vitest";
import {
  isBillingCheckoutUrl,
  isPayPalApprovalUrl,
  phaseFromConfirm,
  readPayPalReturn,
  returnGrantsPlan,
} from "./paypal-return";

describe("PayPal return", () => {
  it("reads the workspace and subscription and ignores a client status", () => {
    const parsed = readPayPalReturn("?workspace=ws-1&subscription_id=I-TEST&status=ACTIVE&token=EC-SECRET");
    expect(parsed).toEqual({ workspaceId: "ws-1", subscriptionId: "I-TEST" });
    expect(readPayPalReturn("?status=ACTIVE")).toBeNull();
    expect(readPayPalReturn("?workspace=ws-1&subscription_id=../admin")).toBeNull();
  });

  it("does not treat the buyer return as an active plan", () => {
    expect(returnGrantsPlan({ queryStatus: "ACTIVE", serverGranted: false, serverStatus: "incomplete" })).toBe(false);
    expect(returnGrantsPlan({ queryStatus: "ACTIVE", serverGranted: false, serverStatus: "active" })).toBe(false);
    expect(phaseFromConfirm({ granted: false, status: "active" })).toBe("pending");
    expect(phaseFromConfirm({ granted: false, status: "incomplete" })).toBe("pending");
    expect(phaseFromConfirm({ granted: true, status: "active" })).toBe("active");
    expect(phaseFromConfirm({ granted: false, status: "canceled" })).toBe("canceled");
    expect(phaseFromConfirm({ granted: false, status: "suspended" })).toBe("suspended");
    expect(phaseFromConfirm({ granted: false, status: "past_due" })).toBe("pastDue");
  });

  it("only follows an approval link on PayPal", () => {
    expect(isPayPalApprovalUrl("https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1")).toBe(true);
    expect(isPayPalApprovalUrl("https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-1")).toBe(true);
    expect(isPayPalApprovalUrl("https://evil.example/paypal")).toBe(false);
    expect(isPayPalApprovalUrl("http://www.paypal.com/approve")).toBe(false);
    expect(isPayPalApprovalUrl(null)).toBe(false);
    expect(isBillingCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test", "stripe")).toBe(true);
    expect(isBillingCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test", "paypal")).toBe(false);
  });
});

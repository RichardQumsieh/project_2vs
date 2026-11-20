import { selectBillingProvider } from "./billing.js";
import { env } from "./env.js";

/** Process billing provider. Disabled unless BILLING_ENABLED=true. */
export const billingProvider = selectBillingProvider({
  enabled: env.BILLING_ENABLED,
  provider: env.BILLING_PROVIDER,
  stripeSecretKey: env.STRIPE_SECRET_KEY,
  prices: {
    FAMILY_PLUS: env.STRIPE_PRICE_FAMILY_PLUS,
    TEAM: env.STRIPE_PRICE_TEAM_SEAT,
  },
  paypal: {
    clientId: env.PAYPAL_CLIENT_ID,
    clientSecret: env.PAYPAL_CLIENT_SECRET,
    environment: env.PAYPAL_ENV,
    webhookId: env.PAYPAL_WEBHOOK_ID,
    plans: {
      FAMILY_PLUS: env.PAYPAL_PLAN_FAMILY_PLUS,
      TEAM: env.PAYPAL_PLAN_TEAM_SEAT,
    },
  },
  fetchImpl: globalThis.fetch.bind(globalThis),
});

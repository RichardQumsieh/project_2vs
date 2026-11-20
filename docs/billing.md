# Billing

Billing is off unless `BILLING_ENABLED=true`. The default does not call Stripe and does not charge anyone. Design-partner workspaces are marked `comped` and still follow the seat limits in [workspaces.md](workspaces.md).

The provider is selected in `backend/src/billing.ts`:

- `disabled` when the flag is false. Checkout returns `billing_disabled` and does not use the network.
- `mock` when the flag is true and `BILLING_PROVIDER=mock` (the default provider). Checkout marks the workspace active inside the process. Tests use this adapter. It never calls Stripe.
- `stripe` when the flag is true and `BILLING_PROVIDER=stripe`. Checkout is attempted only if `STRIPE_SECRET_KEY` and the price id for that plan are set. Otherwise the API returns `billing_unconfigured` and does not call Stripe.

No adapter stores card numbers. The Stripe call is `POST https://api.stripe.com/v1/checkout/sessions` with the secret in the `Authorization` header only.

## Stripe environment variables

Set these on the API process only. Do not put them in frontend settings or source control.

| Variable | Required for live charges | Purpose |
| --- | --- | --- |
| `BILLING_ENABLED` | yes, `true` | Master switch. Default `false`. |
| `BILLING_PROVIDER` | yes, `stripe` | `mock` (default) or `stripe`. |
| `STRIPE_SECRET_KEY` | yes | Secret key (`sk_...`). Never logged on purpose. |
| `STRIPE_WEBHOOK_SECRET` | yes | Signs `POST /billing/stripe/webhook`. |
| `STRIPE_PRICE_FAMILY_PLUS` | for Family Plus | Stripe Price id for the monthly family plan. |
| `STRIPE_PRICE_TEAM_SEAT` | for Team | Stripe Price id billed per seat. |

`checkout.session.completed` sets the workspace plan to active. `customer.subscription.deleted` marks it canceled, which drops a paid plan back to the unpaid seat cap (the owner only) until someone checks out again.

Success and cancel URLs are `{FRONTEND_ORIGIN}/settings/workspace?billing=success` and `?billing=cancel`. The webhook is exempt from the browser origin check and is authenticated by the Stripe signature instead. It stays `404` while billing is off or the provider is not `stripe`.

`GET /health` reports `billing` as `off`, `mock`, or `stripe`. It does not report keys.

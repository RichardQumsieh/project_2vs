# Billing

Billing is off unless `BILLING_ENABLED=true`. The default does not call Stripe or PayPal and does not charge anyone. Design-partner workspaces are marked `comped` and still follow the seat limits in [workspaces.md](workspaces.md).

The provider is selected in `backend/src/billing.ts`:

- `disabled` when the flag is false. Checkout returns `billing_disabled` and does not use the network. This is the default, including when `BILLING_PROVIDER=paypal` is set but the flag is still false.
- `mock` when the flag is true and `BILLING_PROVIDER=mock` (the default provider). Checkout marks the workspace active inside the process. Tests use this adapter. It never calls Stripe or PayPal.
- `stripe` when the flag is true and `BILLING_PROVIDER=stripe`. Checkout is attempted only if `STRIPE_SECRET_KEY` and the price id for that plan are set. Otherwise the API returns `billing_unconfigured` and does not call Stripe.
- `paypal` when the flag is true and `BILLING_PROVIDER=paypal`. Checkout is attempted only if the PayPal client id, client secret, and the plan id for that plan are set. Otherwise the API returns `billing_unconfigured` and does not call PayPal.

No adapter stores card numbers, PayPal access tokens, or client secrets. Stripe calls `POST https://api.stripe.com/v1/checkout/sessions` with the secret in the `Authorization` header only. PayPal calls the Subscriptions API on `api-m.sandbox.paypal.com` or `api-m.paypal.com`. The client secret is sent once, as HTTP Basic auth, to `POST /v1/oauth2/token`. Later calls use the short-lived access token. Logs redact tokens, secrets, and webhook signatures.

Sophia is operated from Jordan. Stripe does not onboard businesses there, so PayPal is the provider for this deployment. The Stripe adapter stays in the code for any later region that can use it.

## Plans

| Plan | Seats | How PayPal bills it |
| --- | --- | --- |
| Free Family | 6 | Not billed. |
| Family Plus | 12 | One subscription. Quantity is 1. |
| Team | up to 50 | One subscription whose quantity is the seat count. Changing seats revises that quantity. |

A paid plan is granted only after PayPal says the subscription is `ACTIVE`, or after a verified webhook says it was activated or a payment completed. The browser return page is not proof of payment. `APPROVED` and `APPROVAL_PENDING` leave the workspace on the unpaid seat cap (the owner only).

`suspended` and `past_due` also drop a paid plan back to that unpaid cap. A completed payment or a new activation restores `active`.

## PayPal sandbox for a Jordan business

Do this in the PayPal sandbox before any live key exists. Sandbox charges are not real.

1. Open a PayPal Business account with the country set to Jordan, if the live account does not exist yet. The sandbox has its own logins. Live verification can wait until the sandbox flow works.
2. Sign in at [developer.paypal.com](https://developer.paypal.com/dashboard/).
3. Go to **Testing Tools → Sandbox Accounts → Create account**. Choose **Business** and country **Jordan**. This account is the merchant that owns the plans. Note the sandbox email and password. They stay in the PayPal dashboard, not in this repo.
4. Create a second sandbox account of type **Personal**. Use it as the buyer who approves a test subscription. A personal sandbox account in a country PayPal already supports (often the United States) is enough for the buyer.
5. Open **Apps & Credentials**. Stay on the **Sandbox** tab. Create an app and link it to the Jordan sandbox business account. Copy the **Client ID** and **Secret** into the API environment below. Do not put them in the frontend, a screenshot, or git.
6. Create two subscription products and plans. The dashboard path is **Apps & Credentials → the app**, or **Subscriptions** in the sandbox business account. You can also call the Subscriptions API with the sandbox access token.
   - Product `Sophia Family Plus`, type Service. Plan: monthly, fixed price `8` USD, quantity not used. Copy the plan id (`P-...`) to `PAYPAL_PLAN_FAMILY_PLUS`.
   - Product `Sophia Team seat`, type Service. Plan: monthly, fixed price `12` USD **per unit**, and turn quantity on (`quantity_supported: true` if you create the plan through the API). Seat changes revise this quantity. Copy the plan id to `PAYPAL_PLAN_TEAM_SEAT`.
   - The prices in the product are USD because the labels in the app are USD. In the sandbox plan form, confirm the currency the Jordan business account is allowed to charge before you save a live plan. Do not invent a different currency in the app.
7. On the same sandbox app, add a webhook. The URL is the public API origin plus `/billing/paypal/webhook`, for example `https://api.example.com/billing/paypal/webhook`. Subscribe to these events:
   - Billing subscription activated
   - Billing subscription cancelled
   - Billing subscription suspended
   - Billing subscription payment failed
   - Payment sale completed
   Copy the **Webhook ID** to `PAYPAL_WEBHOOK_ID`.
8. Put the sandbox values in the API environment. Set `BILLING_ENABLED=true`, `BILLING_PROVIDER=paypal`, and `PAYPAL_ENV=sandbox`.
9. Apply the schema change in [Prisma](#prisma). Restart the API.
10. `GET /health` reports `"billing":"paypal"`. It does not report keys.
11. Sign in as a workspace owner. Open **Upgrade**. Continue to PayPal, sign in as the sandbox buyer, and approve. PayPal sends the browser to `/billing/paypal/return`. That page asks the API to read the subscription. The plan changes only when PayPal’s status is `ACTIVE`. Cancelling on PayPal opens `/billing/paypal/cancel` and does not change the plan.
12. For a Team workspace, set the seat count on the upgrade page, or add and remove members. Sophia sends PayPal a quantity revision. If PayPal asks the buyer to approve the new quantity, the upgrade page sends them to that approval link. The stored seat count changes when PayPal accepts the revision.

Live billing uses the same variables with live values. Complete PayPal’s business check for the Jordan account, create a **Live** app and live plans, set `PAYPAL_ENV=live`, and point the webhook at the production API. Sandbox keys do not work on the live host. Leave `BILLING_ENABLED` false until those live values are in place.

The return URL PayPal is given is `{FRONTEND_ORIGIN}/billing/paypal/return?workspace={id}`. The cancel URL is `{FRONTEND_ORIGIN}/billing/paypal/cancel?workspace={id}`. PayPal adds `subscription_id` and a token. The API ignores any status in that query. It loads the subscription it created and checks `custom_id` against the workspace.

`POST /billing/paypal/webhook` is exempt from the browser origin check. PayPal’s verify-webhook-signature API is the authentication. The cert URL in the webhook must be an `https` URL on `api.paypal.com`, `api.sandbox.paypal.com`, `api-m.paypal.com`, or `api-m.sandbox.paypal.com`, under `/v1/notifications/certs/`. Transmission times older than 10 minutes are rejected. Event ids are stored in `BillingWebhookEvent`, so a repeat delivery does not apply twice. The route allows 60 requests per minute. While billing is off, or the provider is not `paypal`, the route is `404`.

## Environment variables

Set these on the API process only. Do not put them in frontend settings or source control.

| Variable | Required for live charges | Purpose |
| --- | --- | --- |
| `BILLING_ENABLED` | yes, `true` | Master switch. Default `false`. |
| `BILLING_PROVIDER` | yes | `mock` (default), `stripe`, or `paypal`. |
| `STRIPE_SECRET_KEY` | for Stripe | Secret key (`sk_...`). Never logged on purpose. |
| `STRIPE_WEBHOOK_SECRET` | for Stripe | Signs `POST /billing/stripe/webhook`. |
| `STRIPE_PRICE_FAMILY_PLUS` | for Stripe Family Plus | Stripe Price id for the monthly family plan. |
| `STRIPE_PRICE_TEAM_SEAT` | for Stripe Team | Stripe Price id billed per seat. |
| `PAYPAL_CLIENT_ID` | for PayPal | REST app client id. |
| `PAYPAL_CLIENT_SECRET` | for PayPal | REST app secret. Pair it with the client id or leave both empty. |
| `PAYPAL_ENV` | for PayPal | `sandbox` (default) or `live`. |
| `PAYPAL_WEBHOOK_ID` | for PayPal webhooks | Webhook id from the app. |
| `PAYPAL_PLAN_FAMILY_PLUS` | for PayPal Family Plus | Billing plan id (`P-...`). |
| `PAYPAL_PLAN_TEAM_SEAT` | for PayPal Team | Quantity-enabled billing plan id (`P-...`). |

Stripe success and cancel URLs stay `{FRONTEND_ORIGIN}/settings/workspace?billing=success` and `?billing=cancel`. `checkout.session.completed` sets the workspace plan to active. `customer.subscription.deleted` marks it canceled. The Stripe webhook stays `404` while billing is off or the provider is not `stripe`.

`GET /health` reports `billing` as `off`, `mock`, `stripe`, or `paypal`. It does not report keys.

### Example (sandbox, not real keys)

```bash
BILLING_ENABLED=true
BILLING_PROVIDER=paypal
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=replace-with-sandbox-client-id
PAYPAL_CLIENT_SECRET=replace-with-sandbox-secret
PAYPAL_WEBHOOK_ID=replace-with-sandbox-webhook-id
PAYPAL_PLAN_FAMILY_PLUS=P-replace-family-plus
PAYPAL_PLAN_TEAM_SEAT=P-replace-team-seat
```

Leave the flag false in git and in any environment that does not have these values:

```bash
BILLING_ENABLED=false
BILLING_PROVIDER=mock
PAYPAL_ENV=sandbox
```

## Compose

`docker-compose.yml` passes the variables into the API container. Empty values are safe: billing stays off and the provider stays `mock` unless you set them in the repo-root `.env`. `PAYPAL_ENV` defaults to `sandbox`.

```yaml
BILLING_ENABLED: ${BILLING_ENABLED:-false}
BILLING_PROVIDER: ${BILLING_PROVIDER:-mock}
PAYPAL_ENV: ${PAYPAL_ENV:-sandbox}
PAYPAL_CLIENT_ID: ${PAYPAL_CLIENT_ID:-}
PAYPAL_CLIENT_SECRET: ${PAYPAL_CLIENT_SECRET:-}
PAYPAL_WEBHOOK_ID: ${PAYPAL_WEBHOOK_ID:-}
PAYPAL_PLAN_FAMILY_PLUS: ${PAYPAL_PLAN_FAMILY_PLUS:-}
PAYPAL_PLAN_TEAM_SEAT: ${PAYPAL_PLAN_TEAM_SEAT:-}
```

The API command already runs `npx prisma db push` before the server starts, so a Compose restart creates the new billing columns and the webhook table.

## Production

`docker-compose.prod.yml` reads the same names from the repo-root `.env`. The defaults keep billing off, the provider `mock`, and `PAYPAL_ENV` at `sandbox`, so a half-filled file cannot point at the live PayPal API by accident. Set `PAYPAL_ENV=live` only together with the live client id, secret, webhook id, and plan ids, and set `BILLING_ENABLED=true` only then.

`FRONTEND_ORIGIN` must be the public site, because PayPal redirects the owner there. The webhook URL must be the public API origin plus `/billing/paypal/webhook`. `backend/.env.production.example` lists the variables with empty secrets.

## Prisma

This adds `WorkspaceBilling.pendingPlanId` and the `BillingWebhookEvent` table. `pendingPlanId` is the plan the server asked PayPal to start. It is cleared when PayPal confirms. Webhook event ids are stored so a delivery can be applied once.

There is still no `prisma/migrations` directory. From `backend/`:

```bash
npx prisma db push
```

Compose runs that push on API startup. A local `npm run dev` needs the push once after pulling this change, or PayPal confirm and webhook routes fail until the columns exist. Billing stays off until `BILLING_ENABLED=true`, so existing workspaces keep working as design partners while the table is updated.

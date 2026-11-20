# Workspaces, invites, and plans

A person can create a **Family** or **Team** workspace. They become the owner. Owners and admins invite other people. Members can find each other in that workspace and start an end-to-end encrypted direct chat, or a small encrypted group when group E2EE is enabled. The server stores membership and opaque ciphertext. It does not store chat plaintext.

## Roles

- **Owner** — one at a time. Changes roles, transfers ownership, removes members, creates and revokes invites, and starts checkout.
- **Admin** — creates and revokes invites, and removes members. Cannot change roles or remove an owner or another admin.
- **Member** — sees the directory and can start chats with other members.

## Invites

Invites are single-use codes. The API stores a SHA-256 hash and the last four characters, not the code. Creating an invite returns the code once. The link is `/join?code=...`. Nothing is emailed. The existing approval-gated mail path is unchanged and is not used here.

Codes expire. The default is 7 days. The maximum is 14 days. A used, revoked, expired, or unknown code returns the same “not valid” response. Creation is limited to 8 per hour per account, and redemption to 10 per 15 minutes per account, with a separate IP limit. Those events are appended to the account activity log (created, revoked, redeemed, plus role and removal changes). The log row does not include the code.

## Plans

| Plan | Seats | Manager daily brief | Price label |
| --- | --- | --- | --- |
| Free Family | 6 | No | Free |
| Family Plus | 12 | No | $8 / month |
| Team | 50, per seat | Yes, when the plan is entitled | $12 / seat / month |

Limits are in `backend/src/plans.ts` and are enforced when an invite is created or redeemed. Pending unused invites count toward the seat cap. A paid plan that is not entitled (billing on, checkout not finished) allows only the owner.

People with **no workspace** keep today’s daily brief, which stays on unless `DAILY_BRIEF_ENABLED` is `false`. After someone belongs to a workspace, the brief is served only when one of their workspaces is on an entitled plan that includes it. Right now that is Team. A family-only workspace does not get the brief. `GET /daily-brief` then returns `402` with `daily_brief_plan`.

While `BILLING_ENABLED` is false (the default), a new team workspace is marked `comped`: the seat cap and the brief apply, and nobody is charged. See [billing.md](billing.md).

## Schema

`npx prisma db push` (from `backend/`) creates:

- `Workspace`, `WorkspaceMember`, `WorkspaceInvite`, `WorkspaceBilling` (`pendingPlanId` records the plan a checkout asked for; it is not proof of payment)
- `BillingWebhookEvent` for PayPal webhook ids that have already been applied
- `DesignPartnerRequest` for the public waitlist
- activity actions `WORKSPACE_CREATED`, `INVITE_CREATED`, `INVITE_REVOKED`, `INVITE_REDEEMED`, `WORKSPACE_MEMBER_REMOVED`, `WORKSPACE_ROLE_CHANGED`

There is no `prisma/migrations` directory. API containers already run `prisma db push` on startup. A local `npm run dev` needs the push once after this change, or workspace routes and the waitlist will fail until the tables exist. If those tables are missing, the daily brief keeps the previous default instead of failing closed.

```bash
cd backend
npx prisma db push
```

## Public pages

`/` explains encryption, safety numbers, and approval-gated Sophia, and links to `/pricing`. `/pricing` lists the plans in English and Arabic and has **Join as design partner**. That form is `POST /waitlist`. It stores the email, locale, and optional note. It does not send mail.

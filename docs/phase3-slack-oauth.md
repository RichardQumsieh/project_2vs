# Phase 3 — Slack collab OAuth (JCR-14)

## Privacy
- Does **not** touch E2EE chat. No chat plaintext in OAuth or collab tables.
- Tokens encrypted at rest (`TOTP_ENCRYPTION_KEY` AES-GCM helpers).
- Sync stores owner-scoped **channel name / id / private|archived** mirrors only.
- **No** `channels:history` (message bodies stay out of default Phase 4).
- Phase 4.2 adds `chat:write` for posting to a chosen channel after reconnect.
- Sophia/AI must **not** consume Slack mirrors without a separate `AiAuthorizationConsent`.

## Env (optional until ready)
| Variable | Purpose |
|----------|---------|
| `API_PUBLIC_ORIGIN` | Public API origin for OAuth `redirect_uri` |
| `SLACK_OAUTH_CLIENT_ID` / `_SECRET` | Slack app credentials |
| `INTEGRATIONS_WRITE_ENABLED` | Gate Slack (and other) write APIs; default `false` |

Redirect URI:
- `{API_PUBLIC_ORIGIN}/integrations/collab/slack/callback`

User scopes (`user_scope`): `channels:read`, `groups:read`, `users:read`, `chat:write`

Message write API: see `docs/phase4-write-oauth.md`.

## How to try
1. Create a Slack app → OAuth & Permissions → add redirect URI above → install with user scopes.
2. Set env vars; `npx prisma db push`.
3. Settings → Integrations → Slack → Connect → Sync now.
4. Disconnect revokes locally (and `auth.revoke` when reachable) and deletes channel mirrors.

Without OAuth env, authorize returns **503**.

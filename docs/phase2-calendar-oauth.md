# Phase 2 — Google / Outlook Calendar OAuth (JCR-9)

## Privacy
- Does **not** touch E2EE chat. No chat plaintext in OAuth or calendar tables.
- Refresh tokens encrypted at rest (`TOTP_ENCRYPTION_KEY` AES-GCM helpers).
- Sync stores owner-scoped **title + time window** mirrors only (no event description/body).
- Sophia/AI must **not** consume calendar mirrors without a separate `AiAuthorizationConsent` (not granted by calendar connect).

## Env (all optional until ready)
| Variable | Purpose |
|----------|---------|
| `API_PUBLIC_ORIGIN` | Public API origin for OAuth `redirect_uri` |
| `GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET` | Google OAuth client |
| `MICROSOFT_CALENDAR_CLIENT_ID` / `_SECRET` | Microsoft identity platform app |

Register redirect URIs:
- `{API_PUBLIC_ORIGIN}/integrations/calendar/google/callback`
- `{API_PUBLIC_ORIGIN}/integrations/calendar/outlook/callback`

Scopes:
- Google: `calendar.readonly`
- Outlook: `offline_access`, `Calendars.Read`, `User.Read`

## How to try
1. Set env vars on the API; `npx prisma migrate deploy` (or `db push` in dev).
2. Sign in → Settings → Integrations.
3. Connect → consent → Sync now → mirrored events list.
4. Disconnect revokes locally (and Google revoke endpoint when reachable) and deletes mirrors.

Without OAuth env, authorize returns **503** with `missingEnv` — UI shows “not configured”.

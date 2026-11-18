# Phase 2 — Gmail / Outlook Mail OAuth (JCR-10)

## Privacy
- Separate from server `GMAIL_*` recovery-sender credentials.
- Scopes: Gmail `gmail.readonly` + `gmail.compose` + `gmail.send`; Outlook `Mail.ReadWrite` + `Mail.Send` (+ `offline_access`, `User.Read`). Add the send scopes in Google Cloud and Azure, then reconnect.
- Mirrors store **subject / from / snippet** only — not full bodies.
- Connecting mail ≠ AI consent; chat E2EE unchanged.
- Draft write APIs: see `docs/phase4-write-oauth.md` (`INTEGRATIONS_WRITE_ENABLED`).

## Env
| Variable | Purpose |
|----------|---------|
| `API_PUBLIC_ORIGIN` | Shared with calendar OAuth redirects |
| `GOOGLE_MAIL_CLIENT_ID` / `_SECRET` | Per-user Gmail read |
| `MICROSOFT_MAIL_CLIENT_ID` / `_SECRET` | Per-user Outlook mail read |

Redirect URIs:
- `{API_PUBLIC_ORIGIN}/integrations/email/gmail/callback`
- `{API_PUBLIC_ORIGIN}/integrations/email/outlook-mail/callback`

## How to try
Settings → Integrations → Gmail / Outlook Mail → Connect → Sync now.
Without env, authorize returns 503.

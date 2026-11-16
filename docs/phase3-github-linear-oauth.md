# Phase 3 — GitHub / Linear OAuth (JCR-13)

## Privacy
- Does **not** touch E2EE chat. No chat plaintext in OAuth or work-item tables.
- Tokens encrypted at rest (`TOTP_ENCRYPTION_KEY` AES-GCM helpers).
- Sync stores owner-scoped **title / state / url / number** mirrors only (no issue bodies, comments, or descriptions).
- Jarvis/AI must **not** consume work mirrors without a separate `AiAuthorizationConsent` (not granted by connect).

## Env (all optional until ready)
| Variable | Purpose |
|----------|---------|
| `API_PUBLIC_ORIGIN` | Public API origin for OAuth `redirect_uri` |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | GitHub OAuth App |
| `LINEAR_OAUTH_CLIENT_ID` / `_SECRET` | Linear OAuth application |

Register redirect URIs:
- `{API_PUBLIC_ORIGIN}/integrations/work/github/callback`
- `{API_PUBLIC_ORIGIN}/integrations/work/linear/callback`

Scopes:
- GitHub: `read:user`, `repo` (GitHub OAuth Apps have no classic read-only private-repo scope; `repo` is the minimum for private assigned issues/PRs)
- Linear: `read`

## How to try
1. Set env vars on the API; `npx prisma db push` (or migrate) after pulling schema.
2. Sign in → Settings → Integrations → GitHub / Linear.
3. Connect → consent → Sync now → mirrored work items list.
4. Disconnect revokes locally (and provider revoke when reachable) and deletes mirrors.

Without OAuth env, authorize returns **503** with `missingEnv` — UI shows “not configured”.

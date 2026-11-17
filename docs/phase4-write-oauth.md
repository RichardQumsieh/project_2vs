# Phase 4.2 — Write OAuth scopes + owner-scoped write APIs

## Privacy
- Does **not** touch E2EE chat. Write routes never accept chat ciphertext.
- Tokens stay encrypted at rest (`TOTP_ENCRYPTION_KEY`).
- Mirrors remain metadata-first (no widening to full bodies in this slice).
- Logs: opaque connection/external ids + HTTP status only.
- Connect ≠ AI consent. Write scopes ≠ permission for Sophia to read bodies into the model.

## Feature flag
| Variable | Default | Purpose |
|----------|---------|---------|
| `INTEGRATIONS_WRITE_ENABLED` | `false` | Master gate for all `/integrations/...` write routes |

Keep **off** until Google/Azure/GitHub/Linear/Slack consoles include the write scopes below and users reconsent.

## Scopes (authorize lists)

| Provider | Scopes |
|----------|--------|
| Google Calendar | `calendar.events` |
| Outlook Calendar | `offline_access`, `Calendars.ReadWrite`, `User.Read` |
| Gmail | `gmail.readonly`, `gmail.compose` (drafts; no `gmail.send` by default) |
| Outlook Mail | `offline_access`, `Mail.ReadWrite`, `User.Read` (no `Mail.Send` by default) |
| GitHub | `read:user`, `repo` (already write-capable for issues/PR comments) |
| Linear | `read`, `write` |
| Slack | `channels:read`, `groups:read`, `users:read`, `chat:write` (no `channels:history`) |

## Write APIs (authenticated, `ownerUserId = session.sub`)

Accept **already-approved structured payloads only** (agent propose→approve is P4.3).

| Method | Path | Payload summary |
|--------|------|-----------------|
| POST | `/integrations/calendar/:provider/events` | title, startsAt, endsAt, optional description/allDay |
| PATCH | `/integrations/calendar/:provider/events/:externalEventId` | same |
| POST | `/integrations/email/:provider/drafts` | to[], subject, body, optional cc[] |
| POST | `/integrations/work/github/issues` | owner, repo, title, optional body |
| PATCH | `/integrations/work/github/issues` | owner, repo, issueNumber, title/body/state |
| POST | `/integrations/work/github/comments` | owner, repo, issueNumber, body |
| POST | `/integrations/work/linear/issues` | title, teamId, optional description |
| PATCH | `/integrations/work/linear/issues` | issueId, title/description |
| POST | `/integrations/collab/slack/messages` | channelId, text |
| GET | `/integrations/writes/status` | writesEnabled + requiredWriteScopes |

### Authz / errors
- Wrong owner / missing connection → **404** (`denyUnlessOwner`)
- Not connected → **409**
- Missing write scopes → **403** `scope_upgrade_required` + `missingScopes`
- Flag off → **503** `writes_disabled`

## Operator console steps
1. Add the write scopes in each provider console (see Azure checklist + Phase 2/3 docs).
2. Users **Reconnect / Upgrade permissions** in Settings → Integrations.
3. Set `INTEGRATIONS_WRITE_ENABLED=true` and recreate the API container.

## How to try
1. Update consoles + reconnect a test account.
2. Enable the flag.
3. Call a write route with a structured JSON body while signed in as the connection owner.
4. Confirm IDOR: another user receives 404; stale read-only scopes receive 403.

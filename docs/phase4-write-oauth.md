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
| `INTEGRATIONS_WRITE_ENABLED` | `false` | Master gate for all `/integrations/...` write routes. Production Compose defaults this to `false`. |
| `INTEGRATIONS_WRITE_ALLOWLIST` | empty | Optional comma-separated user id, username, or email. When set, only those accounts can write, and only while the flag is `true`. |

Keep the flag **off** in production until you mean to dogfood. An allowlist entry never turns writes on by itself. See the README section "Enable writes for one dogfood account".

## Scopes (authorize lists)

| Provider | Scopes |
|----------|--------|
| Google Calendar | `calendar.events` |
| Outlook Calendar | `offline_access`, `Calendars.ReadWrite`, `User.Read` |
| Gmail | `gmail.readonly`, `gmail.compose` (drafts), `gmail.send` (approved send) |
| Outlook Mail | `offline_access`, `Mail.ReadWrite`, `Mail.Send`, `User.Read` |
| GitHub | `read:user`, `repo` (already write-capable for issues/PR comments) |
| Linear | `read`, `write` |
| Slack | `channels:read`, `groups:read`, `users:read`, `chat:write` (no `channels:history`) |

## Write APIs (authenticated, `ownerUserId = session.sub`)

GitHub, Linear, Slack, and calendar **create** accept already-approved structured payloads.

Mail send, mail draft, calendar reschedule, and calendar delete do **not** call the provider on the legacy routes. Those return `409 approval_required` (or `503` when the flag or allowlist excludes the account) and send nothing.

| Method | Path | What it does |
|--------|------|----------------|
| POST | `/integrations/writes/proposals` | Stores an owner-scoped proposal hash. Does not call Gmail, Outlook, or either calendar API. |
| POST | `/integrations/writes/proposals/:id/approve` | Checks the flag, allowlist, connection, and scopes, then runs the stored action **once**. A repeat returns the first result. |
| GET | `/integrations/writes/proposals/:id` | Status only. No payload, recipients, or event text. |
| POST | `/integrations/calendar/:provider/events` | Create an event (still a direct write, behind the same flag). |
| PATCH | `/integrations/calendar/:provider/events/:externalEventId` | Refuses. Reschedule goes through propose → approve. |
| POST | `/integrations/email/:provider/drafts` | Refuses. Saving a draft goes through propose → approve. |
| POST | `/integrations/email/:provider/send` | Refuses. Sending goes through propose → approve. |
| DELETE | `/integrations/calendar/:provider/events/:eventId` | Refuses. Delete goes through propose → approve. |

Approve actions:

| Action | Providers | Payload |
|--------|-----------|---------|
| `send_email` | `gmail`, `outlook-mail` | to[], subject, body, optional cc / html / attachments |
| `save_draft` | `gmail`, `outlook-mail` | same |
| `reschedule_event` | `google`, `outlook` | title, startsAt, endsAt, externalEventId, optional description |
| `delete_event` | `google`, `outlook` | eventId (the owner-scoped mirror id) |

`idempotencyKey` is the client proposal id (8–80 letters, numbers, `_`, or `-`). The server stores a hash of the normalized payload, not the body. Approve must resend that same payload. A provider error or a dropped response is recorded on that approval and is not sent again. A token or scope failure before the provider is called leaves the proposal pending so the same approval can be retried after reconnect.

Other writes still use their direct routes, behind the same flag and allowlist:

| Method | Path | Payload summary |
|--------|------|-----------------|
| POST | `/integrations/work/github/issues` | owner, repo, title, optional body |
| PATCH | `/integrations/work/github/issues` | owner, repo, issueNumber, title/body/state |
| POST | `/integrations/work/github/comments` | owner, repo, issueNumber, body |
| POST | `/integrations/work/linear/issues` | title, teamId, optional description |
| PATCH | `/integrations/work/linear/issues` | issueId, title/description |
| POST | `/integrations/collab/slack/messages` | channelId, text |
| GET | `/integrations/writes/status` | writesEnabled for this account, allowlistActive, approvalRequired |

### Authz / errors
- Wrong owner / missing approval → **404** (`denyUnlessOwner` / `not_found`). No provider call.
- Not connected → **409** `not_connected`. Nothing was sent; the proposal stays pending.
- Missing write scopes → **403** `scope_upgrade_required` + `missingScopes`
- Flag off → **503** `writes_disabled`
- Flag on but account not in the allowlist → **503** `writes_not_enabled_for_user`
- Direct send, draft, reschedule, or delete → **409** `approval_required`
- Same approval already running → **409** `approval_in_progress` (no second provider call)
- Provider rejected the call → **502** with `email_send_*`, `email_draft_*`, `calendar_reschedule_*`, or `calendar_delete_*`. That approval is not run again.
- Provider response lost → **502** `provider_uncertain`. That approval is not run again.

## Operator console steps
1. Add the write scopes in each provider console (see Azure checklist + Phase 2/3 docs).
2. The dogfood user **Reconnect / Upgrade permissions** in Settings → Integrations.
3. Set `INTEGRATIONS_WRITE_ENABLED=true` and `INTEGRATIONS_WRITE_ALLOWLIST` to that one account, then recreate the API container. Leave the flag false everywhere else.

## How to try one approved send
1. Update consoles and reconnect the dogfood account (write scopes on the connection).
2. Set `INTEGRATIONS_WRITE_ENABLED=true` and `INTEGRATIONS_WRITE_ALLOWLIST` to that account's user id, username, or email. Recreate the API container. Leave this off for any other deployment.
3. In Sophia, stage an email send and click **Approve** once. Or, while signed in as that user, `POST /integrations/writes/proposals` with `action: "send_email"`, the provider, an `idempotencyKey`, and the payload. That call must not deliver mail. Then `POST /integrations/writes/proposals/:id/approve` with the same payload.
4. Confirm one message, one Settings → Activity "Email sent" row, and that a second approve of the same id returns `"replayed": true` without another message.
5. Confirm `POST /integrations/email/gmail/send` returns `approval_required` and does not send. Another user, or this user while the flag is false, gets no provider call.

## How to try the other writes
1. Update consoles + reconnect a test account.
2. Enable the flag (and the allowlist, if you set one).
3. Call a GitHub, Linear, Slack, or calendar-create route with a structured JSON body while signed in as the connection owner.
4. Confirm IDOR: another user receives 404; stale read-only scopes receive 403.

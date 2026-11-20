# Manager daily brief

Sophia can prepare a short morning brief from the mail and calendar the person already connected. It lists today's meetings with a prep note, overlapping events, emails that look like they need a reply, overdue follow-ups, and up to three suggested actions. The actions are a draft reply, a proposed reschedule, and declining a conflicting event by removing it.

Nothing is sent, moved, or deleted when the brief is prepared. Each suggestion is a payload for the existing approval routes in [Provider write APIs](phase4-write-oauth.md). The person has to approve that exact payload. Approval is the only step that talks to Gmail, Outlook, Google Calendar, or Microsoft Graph, and only when `INTEGRATIONS_WRITE_ENABLED` is also on for that account. That write flag stays off unless an operator sets it.

If neither mail nor a calendar is connected, the brief screen stays up and asks the person to connect one. That response is successful. It does not call a model, and it does not store an empty brief that would block the real one later.

## What it reads

The brief uses owner-scoped integration mirrors only:

- calendar title, start, end, busy, and all-day
- mail subject, from address, snippet, and received time

It does not read end-to-end encrypted chats, message plaintext, or ciphertext. A request that includes those fields is ignored by the composer. If a hosted model writes the opening paragraph, that call uses the same Cloud Sophia gate: an active consent, `SOPHIA_MODEL_API_KEY`, and an HTTPS `SOPHIA_MODEL_BASE_URL`. Without those, the brief stays on the deterministic mock wording and does not call a model. The mock wording is stable, so tests and `npm run eval:assistant -- --mode=mock` do not need an API key.

The model, when it is used, receives the brief facts (titles, subjects, and suggestion labels). It does not receive chat transcripts. The meetings, ranked mail, and suggested payloads are still built in code, not parsed out of the model reply.

## Flags

The brief is on unless a flag is exactly `false`. Unset, empty, and `true` all leave it on. `GET /health` reports `dailyBrief` the same way.

| Variable | Where | Effect when exactly `false` |
| --- | --- | --- |
| `DAILY_BRIEF_ENABLED` | API | `GET /daily-brief`, `POST /daily-brief`, and `PUT /daily-brief/preferences` stay closed. The morning pass does not run. |
| `NEXT_PUBLIC_DAILY_BRIEF_ENABLED` | Web | The brief link in Mail and calendar is hidden, and `/inbox/brief` says the brief is off. |

`INTEGRATIONS_WRITE_ENABLED` is a different switch. It stays off by default. Turning the brief on does not send mail or change a calendar.

Local Compose passes both brief flags through from the repo-root `.env`. An unset or empty value stays on. A production web image bakes `NEXT_PUBLIC_DAILY_BRIEF_ENABLED` at build time (`frontend/Dockerfile.prod`), defaulting to on. Changing it means rebuilding the web image. The API flag is read when the API process starts. Set either flag to `false` and recreate the container to turn the brief off.

## Schedule

Each account has a brief time, a language (`en` or `ar`), and an IANA time zone. The default is 07:00, English, `Asia/Amman`. The person sets these on the brief screen.

While the API flag is on, the process checks about once a minute. For accounts that have saved a schedule, or that have a connected mail or calendar, it prepares that local day's brief after the chosen time. An account with neither mail nor calendar connected is skipped for that minute and is not counted as a failure. Opening the brief does the same if the morning pass has not run yet. `POST /daily-brief` prepares one immediately. A day is prepared once until that on-demand refresh replaces it. The pass looks at most at 500 accounts per minute.

## Data

There is no `prisma/migrations` directory. API startup runs `prisma db push`, which creates:

- `DailyBriefPreference` — time, language, and time zone. No mail or calendar text.
- `DailyBrief` — one row per account per local date. The `document` JSON holds the brief: meeting titles, mail subjects, the short narrative, and the unsent action drafts.

Those rows are owner-scoped and removed with the account. Treat `document` like the mail mirror: it is the person's own integration text. Do not log it. The process logger redacts `brief`, `narrative`, `subject`, `snippet`, `prepNote`, `fromAddress`, and the other brief field names, including when they show up inside a request body on the same log call. Handlers log counts, mode, and outcome only.

## Try it

1. Open Mail and calendar and choose Daily brief. The flags are already on unless you set them to `false`.
2. If nothing is connected, the page links to Settings → Integrations. Connect Gmail or Outlook mail, and Google or Microsoft calendar, and let a sync finish. Then choose Prepare now.
3. Set the time and language if you want a morning pass.
4. Read the suggestions. Approve one only if you also want that write to run. With writes still off, approval stops before the provider and nothing is sent.

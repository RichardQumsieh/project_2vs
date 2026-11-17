# PR #1 review — Commitment Radar M1

**PR:** https://github.com/RichardQumsieh/project_2vs/pull/1  
**Branch:** `cursor/commitment-radar-m1-client`  
**Date:** 2026-11-15  
**Verdict:** **Merge-ready** for M1 Radar scope after hardening push (see Fixes). Remaining items below are non-blocking follow-ups.

---

## Scope reviewed

Privacy/E2EE, Task/Project/Reminder/Consent authz, multi-user isolation, approval gates, test gaps, Sophia Radar panel UX. Security subagent + targeted route/client inspection.

---

## Findings

| Sev | Finding | Blocking? | Disposition |
|-----|---------|-----------|-------------|
| Med | Password reset skipped MFA when `totpSecret` was null (email-link-only reset for incomplete enrollment) | App-wide, treated as merge hardening | **Fixed** — reset requires enrolled TOTP; recovery code still accepted |
| Med | `POST /ai/consents` accepted any `conversationId` UUID without membership | Future policy poison | **Fixed** — membership check → 404 |
| Low | `POST /tasks` accepted arbitrary `conversationId` without membership | Metadata integrity | **Fixed** — same membership check |
| Med | No HTTP multi-user IDOR integration tests for task routes | Quality | **Partial** — unit/schema + contract tests; full Fastify/Prisma IDOR harness still follow-up |
| Low | Radar store per-user IDB isolation under-tested | Quality | **Fixed** — `radarStoreUserKey` + isolation assertion |
| Low | Thread allow checkbox usable while analysis toggle off | UX | **Fixed** — disabled until analysis enabled |
| Low | Client counter inflated on every rescan | Observability | **Fixed** — count newly proposed IDs only |
| Info | Accepted task **titles** sync to server (≤160 chars) | Intentional M1 boundary | Documented — not chat dump / not excerpts |
| Info | Full HTTP two-user matrix for tasks/reminders | Follow-up | Non-blocking |
| Info | Legacy assistant-settings migration on shared browser | Already mitigated (consume legacy key) | Non-blocking |

---

## Privacy / E2EE checklist

- [x] Radar analysis post-decrypt on-device (`radar-runtime` / extractor)
- [x] Sync payload = structured accepted task fields only (`radar-sync.ts`)
- [x] `createTaskSchema` rejects `plaintext` / `excerpt`
- [x] `serializeMessage` exposes ciphertext/nonce/header only (no plaintext)
- [x] No Radar plaintext path into Redis/logs observed
- [x] No auto outbound; accept/dismiss/snooze require agent approve

---

## Authz / isolation checklist

- [x] Task/Project/Reminder lists scoped by `session.sub`
- [x] PATCH uses `denyUnlessOwner` → 404
- [x] Project/task refs on create ownership-checked
- [x] Consent DELETE owner-checked; create validates conversation membership
- [x] Assistant settings keyed by `userId`
- [x] Radar IndexedDB keyed by `userId`

---

## Fixes pushed on this PR

1. Conversation membership gate on task create + AI consent create  
2. Password reset requires enrolled authenticator  
3. Radar thread-allow UX + counter accuracy  
4. Extra schema/isolation tests  

---

## How to re-verify

1. Enable Radar analysis → allow thread → approve finding → confirm `POST /tasks` has no excerpt/plaintext  
2. Ask Sophia “what’s outstanding?” / Refresh daily briefing (local only)  
3. Backend: `npm test` (52 passed at review time)  
4. Frontend Radar-focused: store/briefing/planner/settings/sync tests green  

---

## Merge-ready?

**Yes** for Commitment Radar M1. Recommended non-blocking follow-ups: Fastify two-user IDOR integration tests; optional consent list endpoint with owner filter when cloud analysis ships.

# Commitment & Deadline Radar — Architecture Plan

**Status:** Audit only (no feature implementation)  
**Date:** 2026-11-15  
**Sources:** `docs/product-decisions.md`, `docs/project-context.md` (Project store); repo `RichardQumsieh/project_2vs`  
**First milestone:** Radar + Jarvis Q&A panel over authorized tasks/commitments/context

---

## 1. Existing architecture (repo-specific)

### 1.1 AI assistant worker / Jarvis orchestration

Jarvis is **entirely client-side** today, orchestrated from the inbox UI—not a server agent loop.

| Layer | Module | Role |
|---|---|---|
| UI host | `frontend/components/inbox-app.tsx` | Wires companion, planner, agent runtime, memory, speech, research |
| Presence / event filter | `frontend/lib/ai/companion-runtime.ts` | Debounced observation of decrypted `LocalMessage`s; quiet / interactive / active-voice |
| Dialogue prompts | `frontend/lib/ai/companion.ts` | Bounded selected-chat context (6 msgs / 1,600 chars), JSON-quoted untrusted data |
| Fast command planner | `frontend/lib/ai/jarvis-planner.ts` | Wake-word + compound intents (docs, research, draft, remember/forget)—no LLM required |
| Documents | `frontend/lib/ai/jarvis-documents.ts` | PPTX/MD builders; download on approve |
| Allowlisted actions | `frontend/lib/ai/agent-runtime.ts` | Propose → user approve/cancel; audit log; tools: `send_message`, `web_search`, `ui`, `create_document`, `remember_fact`, `forget_fact`, `draft_message` |
| On-device inference | `frontend/lib/ai/local-provider.ts` + `inference.worker.ts` | Hugging Face Transformers / ONNX worker; stream chunks; no remote fallback |
| Reply suggestions | `frontend/lib/ai/suggestions.ts` + `suggestion-scheduler.ts` | Local-only suggested replies (16 msgs / 4k chars) |
| Settings | `frontend/lib/ai/assistant-settings.ts` | Feature flags in `localStorage` (`private-messenger:assistant-settings`) |
| Surfaces | `frontend/app/jarvis/page.tsx`, `frontend/app/settings/jarvis/page.tsx` | Presence/settings pages (not Radar yet) |

**Orchestration flow today:** decrypted thread messages → companion runtime heuristics and/or `parseJarvisCommand` → optional local model turn → `createAgentRuntime().propose(...)` → explicit `approve()` in UI. No server-side tool loop. No Cursor Agent SDK dependency (`package.json` has `@huggingface/transformers`, `pptxgenjs` only).

### 1.2 Memory (storage, isolation, inspect/delete)

| Concern | Current behavior |
|---|---|
| Storage | Browser `localStorage` key `private-messenger:jarvis-memory:{userId}` via `frontend/lib/ai/personal-memory.ts` |
| Shape | `MemoryFact[]` — `{ id, text, createdAt }`; max 80 facts × 240 chars |
| Isolation | Keyed by `userId` (good). **Gap:** `assistant-settings` is **not** keyed by userId—shared across accounts on one browser. |
| Inspect / delete | Loaded in inbox; `forget_fact` / `removeMemoryFact`; settings toggle `personalMemory` |
| Sync | None—device-local only; lost on clear storage / other devices |
| Server | Never uploaded |

Dialogue turns are in-page memory only (cleared on thread leave / Clear)—not long-term memory.

### 1.3 Prisma / DB schema

`backend/prisma/schema.prisma` covers **messenger + auth only**. Relevant models:

- **Users / auth:** `User`, `AuthSession`, `AuthToken`, `TrustedBrowser`, `RecoveryCode`, TOTP fields on `User`
- **E2EE devices/keys:** `Device`, `OneTimePreKey`, `DeviceBackup` (opaque JSON ciphertext), `AccountArchiveKey`, `AccountArchiveMessage`
- **Messaging:** `Conversation`, `ConversationMember`, `Message` (ciphertext/nonce/ratchetHeader only), `MessageDeletion`, `MediaObject` (encrypted blobs by key)

**Missing for Radar (explicit gaps):**

- No `Task`, `Reminder`, `Commitment`, `Project`, `RadarFinding`, or AI-authorization consent tables
- No server-side AI memory / embeddings tables
- No per-user AI preference rows (settings are client-only)

### 1.4 Redis usage

`backend/src/redis.ts` — two `ioredis` clients (`redis`, `redisSub`).

| Use | Location | Contents |
|---|---|---|
| Pub/sub fanout | `conversations.ts` → `user:{userId}` | Message envelopes: **ciphertext + metadata only** via `serializeMessage`; deletion tombstones (IDs, no plaintext) |
| Call signaling state | `call-signaling.ts` → `call:{callId}` | Conversation/caller/callee IDs + status; ICE/SDP in published signals (not chat plaintext) |
| WS bridge | `ws.ts` psubscribe `user:*` | Forwards opaque JSON to that user’s sockets |

**No Bull/BullMQ job queues.** No caching of decrypted messages. **Confirmed: no private message plaintext patterns in Redis today.** Call SDP/ICE is not chat content but is sensitive signaling—acceptable for calls; do not reuse those channels for Radar plaintext.

### 1.5 WebSocket / event architecture

- Endpoint: `GET /ws` (`backend/src/ws.ts`)
- Auth: session cookie via `getSession`; origin check vs `FRONTEND_ORIGIN`
- Per-user socket map; session expiry closes sockets
- Events: `hello`, encrypted `message`, `message_deleted`, `call:*`
- Client decrypts messages locally after receive; Radar must hook **post-decrypt** client paths (same as companion-runtime), not the WS payload itself

### 1.6 E2EE path (server vs client; AI hooks)

**Server sees:** user/device public keys, membership, opaque `Message.ciphertext` / nonce / ratchetHeader, archive ciphertext, media object keys/sizes, metadata timestamps/IDs.

**Server never sees:** message plaintext, location coords (in ciphertext body), album/image plaintext, Jarvis prompts, personal memory, companion dialogue.

**Client decrypt:** X3DH/Double Ratchet + archive path (`frontend/lib/crypto/*`, IndexedDB vault in `frontend/lib/idb.ts`). AI modules consume `LocalMessage.plaintext` **only after** local decrypt.

**Prior AI hooks (all on-device):**

- Companion observations / dialogue / suggestions / summarize context builders
- Jarvis planner → agent runtime
- Optional **research query** to `POST /research/search` (Brave)—user-initiated query string only, not chat dump (`backend/src/routes/research.ts`)
- Optional browser speech cloud if user opts in (`speech-input.ts`)—explicit warning path

**No cloud LLM inference path exists today.** README and code assert no decrypted messages leave the device for AI.

### 1.7 Authorization and per-user isolation

| Layer | Mechanism |
|---|---|
| HTTP | `requireUser` / session JWT (`backend/src/auth.ts`); cookie httpOnly |
| Conversations | `ConversationMember` checks on list/read/send/delete/media (`conversations.ts`) |
| Visibility | `conversation-visibility.ts` — list only if messages exist or user initiated |
| Devices | Device owned by `userId`; backups scoped to device |
| Realtime | Publish only to member userIds; WS bound to session `sub` |
| Client AI | Memory keyed by userId; decrypted messages only for conversations the client already authorized |

**Gaps for multi-user Radar:** no server resource ACL for tasks/commitments yet; assistant settings not per-user; no explicit “authorize conversation for AI / cloud analysis” consent store.

---

## 2. Reusable components (keep / extend)

1. **`createAgentRuntime`** — extend with Radar actions: `create_task`, `create_reminder`, `dismiss_finding`, `edit_commitment` (still propose → approve; never auto-outbound).
2. **`companion-runtime` event model** — same post-decrypt message stream for Radar scanners (debounce, dedupe by message id, cancel on thread switch).
3. **`jarvis-planner` / `companion` prompt builders** — Q&A over Radar store; keep JSON-quoting untrusted chat excerpts.
4. **`local-provider` + worker** — default engine for commitment extraction and briefing prose.
5. **`personal-memory` patterns** — inspect/delete UX; migrate toward a richer local store (see below).
6. **Inbox Jarvis panel UI** in `inbox-app.tsx` — host for Radar findings list + Q&A (avoid a disconnected surface).
7. **Auth + membership** — any sync API must reuse `requireUser` + owner/`userId` filters; never trust client-supplied owner ids.
8. **Redis pub/sub** — optional later for `radar:sync` *ciphertext or opaque sync tokens only*; not for plaintext findings.
9. **Research route pattern** — model for rate-limited, authenticated, non-chat external calls if cloud AI is ever authorized.

---

## 3. Missing infrastructure

| Gap | Why needed for milestone 1 |
|---|---|
| Commitment / task / reminder / project domain model | Product requires attribute, link, approve/edit/dismiss, daily briefing |
| Client-side Radar store (IndexedDB) | E2EE-safe analysis results must live where plaintext already is |
| Conversation AI authorization flags (client + optional server consent receipt) | “Authorized conversations” + cloud opt-in |
| Finding lifecycle (pending → accepted task / dismissed) | User control before consequential persistence |
| Q&A retrieval over local Radar + memory | Jarvis panel over authorized context |
| Per-user settings keying | Multi-account browser isolation |
| Server task sync (minimal, user-owned, **non-message** fields or E2EE blobs) | Multi-device / multi-user product stance—without putting chat plaintext on server |
| Job queue (Redis/Bull) | **Not required for milestone 1** if analysis is on-device; revisit only for server-side authorized cloud jobs |
| Cloud AI provider adapter + explicit consent UX | Only if user authorizes; not default |
| Observability without plaintext | Structured events: counts, latencies, error codes—never bodies |

---

## 4. Minimal DB + API changes (milestone 1 recommendation)

**Principle:** Keep chat E2EE intact. Prefer **on-device Radar corpus**. Add only thin, user-scoped server resources for tasks the user explicitly accepted (titles/due dates they typed or approved—not raw chat).

### 4.1 Prisma (minimal)

```text
AiAuthorizationConsent
  id, userId, scope (enum: CLOUD_AI | CONVERSATION_ANALYSIS), 
  conversationId?, grantedAt, revokedAt?, evidenceVersion

Project
  id, ownerUserId, name, createdAt, updatedAt

Task
  id, ownerUserId, projectId?, title, dueAt?, status (OPEN|DONE|DISMISSED),
  source (MANUAL|RADAR), createdAt, updatedAt

Reminder
  id, ownerUserId, taskId?, remindAt, status, createdAt

# Optional if cross-device Radar metadata needed without plaintext:
# RadarBlob: ownerUserId, deviceId, ciphertext, nonce, updatedAt
```

**Do not** add `Message.plaintext`, finding text columns that mirror chat, or embedding tables of private messages on the server for v1.

### 4.2 API (minimal)

- `GET/POST/PATCH /tasks`, `GET/POST/PATCH /reminders`, `GET/POST /projects` — all `requireUser`, filter `ownerUserId = session.sub`
- `POST /ai/consents`, `DELETE /ai/consents/:id` — record/revoke cloud or analysis authorization (metadata only)
- **No** `POST /ai/analyze-messages` that accepts plaintext transcripts in milestone 1
- Optional later: `PUT /ai/radar-blob` opaque device backup (same pattern as `DeviceBackup`)

### 4.3 Client modules (new, no server plaintext)

- `frontend/lib/ai/radar-extractor.ts` — heuristic + optional local-LLM extraction from authorized decrypted messages
- `frontend/lib/ai/radar-store.ts` — IndexedDB findings/commitments keyed by `userId`
- `frontend/lib/ai/radar-briefing.ts` — daily briefing builder
- Wire into `agent-runtime` + inbox Jarvis panel

---

## 5. Security / privacy risks

1. **E2EE bypass via “helpful” server analysis** — Highest risk. Any API that uploads decrypted chat for Radar violates product decisions. **Mitigation:** on-device default; reject server analyze endpoints unless separate explicit product change + consent.
2. **Cloud AI authorization UX** — Users may not understand permanent/revocable scope. **Mitigation:** consent records with scope, conversation allowlist, revoke path, no silent defaults (`automaticOnlineResearch` style: opt-in).
3. **Prompt injection from contacts** — Already partially handled (JSON-quote, untrusted data labels). Radar extraction must treat peer text as data; never auto-`send_message`.
4. **localStorage memory / settings leakage** on shared browsers — Settings not per-user; memory is. **Mitigation:** key settings by `userId`; prefer IndexedDB; clear on logout.
5. **Redis / logs** — Safe today for messages. Risk if future workers enqueue `{ plaintext, conversationId }`. **Mitigation:** forbid plaintext in queue payloads; redact in Fastify logs; CI grep for dangerous patterns.
6. **Cross-user IDOR on new Task APIs** — Classic risk. **Mitigation:** owner checks in every handler; tests for user B cannot read user A’s tasks.
7. **Research/Brave query leakage** — Queries may imply private commitments. **Mitigation:** keep approval gate; never auto-fire from Radar.
8. **Model cache / HF downloads** — Weights remote; prompts local. Preserve that boundary if adding cloud providers.

---

## 6. Recommended on-device vs server split (Radar)

| Concern | Placement | Rationale |
|---|---|---|
| Scan decrypted messages for promises/deadlines | **On-device** | Only client has plaintext |
| Finding propose / edit / dismiss UI | **On-device** | Matches agent-runtime approval model |
| Accepted tasks / reminders / projects (user-approved structured data) | **Server (user-owned)** + local cache | Multi-device & multi-user product; not chat ciphertext |
| Daily briefing generation | **On-device** | Uses local findings + tasks |
| Jarvis Q&A over commitments | **On-device** (local model / planner) | Keeps context private |
| Cloud LLM extraction | **Off by default**; only after `AiAuthorizationConsent` + per-conversation allow | Product rule |
| Redis queues for analysis | **Skip in milestone 1** | No server plaintext jobs |
| Push “reminder due” events | Server can notify **task id / remindAt only** over existing WS pattern | No message body |

**Default posture:** Radar analyzer = sibling of `companion-runtime` on the client. Server stores **explicit task objects the user accepted**, never the supporting chat quotes unless those quotes stay in local IndexedDB only.

---

## 7. Cursor Agent SDK — keep or skip?

**Recommendation: Skip for milestone 1 (and likely longer).**

| Factor | Assessment |
|---|---|
| Existing orchestration | `createAgentRuntime` already implements propose/approve/audit/allowlist—the exact safety model Radar needs |
| E2EE fit | SDK agents typically assume server/tool host context; plaintext chat cannot live there without breaking privacy rules |
| Dependency / ops | No SDK in repo; adding it buys hosting/session complexity without unlocking on-device extraction |
| When to reconsider | Phase 2+ **user-authorized** cloud workflows (calendar/email tools) *if* SDK’s tool policy + consent UX clearly beats extending `agent-runtime` + Fastify routes |

Extend `agent-runtime` tool unions and inbox approval UI instead of introducing a parallel agent stack.

---

## 8. Phased implementation — first milestone only

**Goal:** Radar + Jarvis Q&A panel over authorized context. No calendar/email/GitHub. No automatic outbound messages.

### Phase M1.0 — Foundations (client)
1. Per-user assistant settings key (`userId` suffix).
2. `radar-store` (IndexedDB): findings, local commitment drafts, conversation allowlist for analysis.
3. Settings: “Analyze authorized conversations on this device” + per-thread allow toggle.
4. Extend `companion-runtime` or parallel scanner: heuristic extraction (due dates, “I’ll…”, “please send by…”) → pending findings.

### Phase M1.1 — Approval loop
5. New agent tools: `accept_finding` → task, `dismiss_finding`, `snooze_reminder` (propose/approve).
6. Inbox Jarvis panel section: Pending findings → Approve / Edit / Dismiss.
7. Unit tests mirroring `agent-runtime.test.ts` / `jarvis-planner.test.ts`.

### Phase M1.2 — Minimal server sync
8. Prisma `Project` / `Task` / `Reminder` + CRUD routes with owner authz tests.
9. Client sync of **accepted** tasks only (not raw findings/chat).
10. Optional `AiAuthorizationConsent` table for future cloud; unused by default path.

### Phase M1.3 — Q&A + briefing
11. Planner intents: “what’s outstanding?”, “what did I promise X?” over local radar-store + tasks.
12. Daily briefing view in Jarvis panel (local generation).
13. Observability: client counters; server metrics on task CRUD only.

**Exit criteria:** User can allow a thread, see proposed commitments from decrypted history, approve into tasks, ask Jarvis NL questions about those tasks/findings, with zero chat plaintext on server/Redis/logs.

---

## 9. Test / authz / observability checklist

### Tests
- [ ] Extractor: fixtures for promise/deadline/question; no false trigger on empty/media-only
- [ ] Radar store isolation: user A facts invisible under user B key
- [ ] Agent runtime: accept/dismiss require approve; expired proposals fail
- [ ] Planner Q&A uses only allowlisted conversation + accepted tasks
- [ ] API: unauthenticated 401; user B cannot GET/PATCH user A task/reminder/project
- [ ] Consent revoke stops any cloud path (even if cloud not shipped yet—stub test)
- [ ] Regression: `serializeMessage` / Redis publish fixtures contain no plaintext fields
- [ ] Existing companion/memory/PPTX tests remain green

### Authz
- [ ] Every new route: `requireUser` + `ownerUserId = session.sub`
- [ ] Conversation allowlist enforced client-side before scan; server never receives allowlist plaintext
- [ ] No Radar tool can `send_message` without separate existing approval path
- [ ] Logout clears in-memory Radar scan state

### Observability (plaintext-safe)
- [ ] Metrics: findings_proposed_count, tasks_created_count, extract_latency_ms, sync_error_rate
- [ ] Logs: request id, user id hash/uuid, error code—**never** title/body if titles may be sensitive; prefer opaque ids
- [ ] Alert on spike of 403/401 on task routes (IDOR probes)
- [ ] CI secret/plaintext lint: ban `plaintext` in `backend/src` Redis publish payloads

---

## 10. Summary verdict

| Question | Answer |
|---|---|
| Can Radar ship inside existing Jarvis? | **Yes** — extend client runtime + inbox panel |
| Does server already have tasks/reminders? | **No** — add minimal user-owned schema |
| Is Redis safe for private chat? | **Yes today** (ciphertext/metadata only); no analysis queues yet |
| Default analysis locus | **On-device** post-decrypt |
| Cursor Agent SDK | **Skip** — `agent-runtime` already fits |
| First build slice | Local store + extractor + approve loop + thin Task API + Q&A/briefing |

**Next step after plan approval:** implement M1.0–M1.1 client foundations only; then minimal Prisma/API (M1.2). Do not open cloud message analysis in the first milestone.

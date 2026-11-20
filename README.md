# Private messenger

Direct-message E2EE, plus a feature-flagged MLS prototype for small groups (up to 8 members). See `docs/group-e2ee.md`.

## Architecture

- The Fastify API stores accounts, device **public** keys, and opaque ciphertext.
- Identity, signed prekeys, one-time prekeys, and Double Ratchet state live in the browser.
- Messages are encrypted separately to each active device with its own X3DH/Double Ratchet session and also to each account's stable archive public key. The server stores only opaque archive ciphertext; a newly authenticated device decrypts it locally and creates its own independent device identity and ratchets. It never restores another device's live ratchet state.
- The portable archive is intentionally a long-lived encrypted copy for recovery, not a forward-secret ratchet: compromise of an unlocked archive private key exposes that account's archived messages. Per-device Double Ratchets remain separate. The API and frontend delivery remain trusted; this design protects against database-only access, not a malicious or fully compromised service.
- The account archive private key is wrapped locally with the account password and with a separate random 256-bit history recovery code. Save the history recovery code when it is first shown: it is required to unlock existing history after a password reset if the old password is no longer available. The server stores a hash of this high-entropy code for recovery authorization, never the code or archive private key. Losing both the password and recovery code means the archive cannot be decrypted. Because the server stores a password-wrapped key, a database-only compromise could enable offline password guessing; use a unique, strong password.
- Sign-in requires email and password on a browser trusted within the last 30 days. A new browser, expired trust, or change in the observed IP network prefix triggers an authenticator challenge. After TOTP succeeds, users can explicitly trust that browser for 30 days; recovery codes do not create browser trust. Trusted-browser credentials are random, HttpOnly cookies; only their hashes and a coarse network prefix are stored server-side. Logout preserves browser trust for convenience, while password reset revokes trusted browsers. IP-prefix checks are a coarse risk signal, not precise location detection. Client IP and HTTPS detection use Fastify `request.ip` and `request.protocol`. `TRUST_PROXY` defaults to off, so `X-Forwarded-For` and `X-Forwarded-Proto` are ignored and a client cannot spoof them. Behind a reverse proxy, set `TRUST_PROXY` to that proxy's IP or CIDR only; `true` is rejected at startup. Until it is set, every connection shares the proxy address, auth rate limits share one bucket, and HSTS stays off because the app still sees HTTP. The API process speaks HTTP; production TLS terminates at the proxy.
- An optional Google Drive backup encrypts the archive private key in the browser with the history recovery code and uploads only the ciphertext to Drive's private `appDataFolder`. The backup requires both Google account access and the recovery code to restore. Google does not receive the code or plaintext key. It is an additional copy, not a way to recover a lost recovery code; it cannot protect against a compromised browser/device or malicious frontend delivery.
- Existing messages are added to the account archive by an unlocked device that still has their plaintext. History already lost before a device can decrypt and backfill it cannot be recovered. The device-scoped encrypted recovery backups remain separate and are not used to clone a device's identity or ratchet sessions onto another device.
- This protects archive contents from database-only access, not from a fully compromised API or modified frontend delivery; those remain in the application's trust boundary.
- Private keys are wrapped with a PBKDF2-derived AES-GCM key and stored in IndexedDB. After a successful password unlock, this browser also remembers the non-exportable Web Crypto key in IndexedDB so a refresh does not require the password again; explicit sign-out removes it.
- X3DH establishes a shared secret; a Double Ratchet (X25519 + HKDF + AES-GCM) encrypts each direct message.
- Small groups use MLS (RFC 9420) via `ts-mls` 1.6.4, behind `GROUP_E2EE_ENABLED` and `NEXT_PUBLIC_GROUP_E2EE_ENABLED` (both default off). The API stores opaque MLS bytes and membership only. The inbox can create a group, send, and show members when both flags are on. Group secrets are sealed with the vault key. An admin commits adds, removals, and self-leave so removed members cannot derive later epoch keys. Design, threat model, and gaps: `docs/group-e2ee.md`.
- WebSockets notify clients; Redis pub/sub is the fan-out path for multiple API processes.
- One-to-one audio and video calls use browser WebRTC. The API authenticates and relays call signaling only; WebRTC encrypts media in transit between the participants.

The Prisma schema matches the requested models, plus the fields a real handshake needs: signing key, signed prekey, and one-time prekeys. `Conversation.directKey` keeps 1:1 threads unique.

## Run with Docker

Development mode starts PostgreSQL, Redis, the API, and the Next.js app. Compose reads secrets from a gitignored repo-root `.env` and refuses to start without them:

```bash
cp .env.example .env
# Generate values. Do not commit .env, and do not reuse a key from git history.
# JWT_SECRET=$(openssl rand -base64 32)
# TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)
docker compose up --build
```

Open http://localhost:3000. Source files are mounted into the frontend and backend containers for development reloads.

### One-to-one voice and video calls

Open a direct conversation and use the phone or camera button to call. The browser asks for microphone access, and for video calls camera access; the recipient must answer before media is connected. Calls use WebRTC peer-to-peer media with DTLS-SRTP encryption. The backend relays the offer, answer, and network candidates but does not receive call audio or video. ICE negotiation can reveal participants' public network addresses to each other and to configured STUN/TURN providers.

Google STUN servers are used by default. STUN is sufficient for many networks, but restrictive firewalls and carrier-grade NAT may require a TURN relay. To enable one, configure a Coturn-compatible TURN service with a shared-secret authentication key, then set the backend-only variables `TURN_URLS` (comma-separated `turn:` or `turns:` URLs) and `TURN_SHARED_SECRET` (at least 32 characters). The API issues one-hour, per-user TURN credentials; do not expose the shared secret to the frontend. TURN is optional, but without it some participants' networks will not connect. Production calls require HTTPS so browsers permit camera and microphone access.

### Private photo, video, and voice-note sharing

Photos, videos, and voice notes are encrypted in the browser with AES-GCM before upload. The encrypted bytes go directly to a **private** Backblaze B2 bucket through a short-lived signed URL; media keys, nonces, MIME types, durations, and optional captions travel inside the existing end-to-end-encrypted message. The API authorizes conversation members and signs downloads, but never receives media plaintext or keys. Photos are limited to 6 MB (JPEG, PNG, WebP, or GIF), and can be locally decorated with emoji, text, drawing, and appearance filters before sending. Edited photos are resized to at most 2048 pixels on their longest edge and exported as WebP under 6 MB; use **Use original** to preserve the original image, including GIF animation. Videos must be 75 seconds or shorter and are compressed on-device to at most 854×480 at 15 fps before encryption; the encrypted upload is capped at 6.5 MB. Video compression uses the browser's MediaRecorder, canvas, and Web Audio APIs, and takes approximately as long as playing the clip.

Voice notes are recorded with the browser's MediaRecorder, then transcribed on-device by a multilingual Whisper model with automatic language detection. Captions are editable before sending and are included in the encrypted message; audio uploads are capped at 6.5 MB. The model files may be downloaded from Hugging Face on first use and cached by the browser. Audio is not sent to the model host or any speech-recognition service; only encrypted audio is uploaded to Backblaze.

Document attachments support PDF, DOCX, PPTX, XLSX, UTF-8 TXT, and CSV up to 450 MiB. The browser checks the extension against file signatures; Office documents are inspected for ZIP structure, macros, embedded/active content, expansion limits, and external relationship links before AES-GCM encryption. The server applies the 450 MiB encrypted-file limit and keeps all media private in B2. Attachments download as files and are never previewed or opened inside the app; downloads are restricted to HTTPS Backblaze B2 URLs and redirects are blocked.

### Encrypted location sharing

Current location can be shared from the attachment menu after the browser grants geolocation permission. Latitude, longitude, optional accuracy/altitude, and an optional caption are packaged into the encrypted message body and sent through the existing Double Ratchet path. The API stores only ciphertext; coordinates are never uploaded as a separate media object or map tile request. Recipients decrypt locally and see a privacy-preserving pin card. Opening OpenStreetMap is an explicit action that discloses coordinates to that map provider; the app does not auto-load map tiles for shared locations.

These are risk-reduction checks, not antivirus scanning or a guarantee that a file is safe. End-to-end encryption means the server cannot scan plaintext. PDF active content or links, text/CSV formulas, newly discovered malware, and vulnerabilities in office/PDF readers can still pose risk. Only download files from people you trust, keep your document reader up to date, and do not follow unexpected links. Office link warnings cover detected external relationship links; absence of a warning does not prove a file is safe.

### Optional encrypted Google Drive archive-key backup

The inbox has an **Encrypted Drive backup** option. It asks for the existing history recovery code, encrypts the archive private key on the device, and stores the ciphertext in the signed-in Google account's hidden app-data folder. To restore on a new browser, choose **Restore my encrypted archive key from Google Drive** on the login form, connect the same Google account, and provide the recovery code. If the server already has the archive key, the restored key must match it; if that key record is missing, the encrypted backup can recreate it without changing the archive key.

Google Drive setup is optional. In Google Cloud, enable the Google Drive API and create an OAuth 2.0 **Web application** client. Add the app's exact origins (for local Docker, `http://localhost:3000`) to Authorized JavaScript origins. Configure the OAuth consent screen for your intended audience. The app requests only the `drive.appdata` scope and does not store a Google refresh token.

For Docker Compose or direct frontend development, set `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` in `frontend/.env.local`. Compose passes this file into the frontend container; recreate the frontend after changing it so Next.js can inline the public value into the client bundle. This is a public OAuth client ID, not a client secret. If unset, the Google Drive backup and restore controls remain unavailable.

### Local browser security

The local frontend sends a nonce-based Content Security Policy that blocks inline scripts and unapproved script sources, along with clickjacking and MIME-sniffing protections. The development policy allows `unsafe-eval` only for Next.js development tooling; production builds omit it. Google Identity Services is the only configured external script source. CSP reduces the impact of script injection but cannot protect against a compromised browser, local machine, dependency, or application server. Docker-published app, database, and Redis ports bind to `127.0.0.1` and are not intended to be reachable from other machines.

Set these backend environment variables from your B2 bucket and S3-compatible application key:

- `B2_BUCKET`: bucket name.
- `B2_REGION`: bucket region, for example `us-west-004`.
- `B2_ENDPOINT`: regional S3 endpoint, for example `https://s3.us-west-004.backblazeb2.com`.
- `B2_KEY_ID` and `B2_APPLICATION_KEY`: the key ID and secret application key. Keep these server-side; never add them to frontend settings or source control.

For local Docker Compose, put the values in `backend/.env` and recreate the backend container. Production Compose reads them from the shell environment, so set/export them before starting the stack. The backend configures bucket CORS for `FRONTEND_ORIGIN` on the first upload; the application key must permit the required bucket CORS update and object read/write operations. Keep the bucket private—public access is not needed.

For production images, put Compose-interpolated secrets in a **repo-root** `.env` (see `.env.example`), then use the production override. `FRONTEND_ORIGIN` defaults to `https://sophia.apps.grok.bot`; `NEXT_PUBLIC_API_URL` defaults to `https://api.sophia-build.com` so API-only `build backend` does not require the frontend build arg. `COOKIE_SECURE` is forced `true` in the prod overlay. `NODE_ENV` is `production`. Leave `TRUST_PROXY` empty until you set it to the reverse proxy IP or CIDR; do not set `true`. The local Postgres password in Compose is a localhost default and must not be reused for a database reachable beyond the host.

```bash
cp .env.example .env
# Fill JWT_SECRET and TOTP_ENCRYPTION_KEY on the host (never commit).
# Optional: FRONTEND_ORIGIN / NEXT_PUBLIC_API_URL if not using the Sophia defaults.
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d postgres redis backend
```

```powershell
# Or export in the shell instead of root .env:
$env:JWT_SECRET = "replace-with-at-least-32-random-characters"
$env:TOTP_ENCRYPTION_KEY = "replace-with-64-hex-characters"
$env:FRONTEND_ORIGIN = "https://sophia.apps.grok.bot"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d postgres redis backend
```

Stop the stack with `Ctrl+C`, or run `docker compose down` from another terminal.

## Run locally

1. Start Postgres and Redis:

```bash
docker compose up -d
```

2. API:

```bash
cd backend
npm install
cp .env.example .env
# Replace JWT_SECRET and TOTP_ENCRYPTION_KEY with random values.
# Set BRAVE_SEARCH_API_KEY in backend/.env to enable automatic web research.
npx prisma generate
npx prisma db push
npm run dev
```

3. Web app:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, create two accounts in two browsers (or profiles), then start a chat by username.

Use a current Chromium, Firefox, or Safari build. Device keys use Web Crypto `X25519` and `Ed25519`.

If a conversation reports that the other account has no active messaging device, that account must sign in and unlock the app in the current version at least once so its browser can create and register its device keys. This also applies after a password reset, which revokes the account's previous devices. Retry sending after the other participant has completed sign-in.

## Private on-device AI

The assistant now presents as **Sophia**, a private third presence in the selected thread, with two complementary paths: a fast local command planner for compound voice/text tasks, and a multi-turn on-device dialogue for open conversation. Optional proactive suggested replies after incoming messages remain available. Sophia can discuss the selected chat when that context is enabled, brainstorm next steps, answer unrelated questions, and help draft a reply. Dialogue turns are separate from contact messages. Draft insertion only fills the normal composer; it never sends. Suggested replies also remain manual. The assistant is off by default; enabling free-form dialogue may download approximately 570 MB of model files and uses device memory and compute. Compound Sophia commands (for example: prepare a presentation, research competitors, organize a meeting) are parsed locally without waiting on the language model and only stage allowlisted actions for explicit approval.

### Adaptive appearance

Behind `NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED` (default off; production Compose leaves it unset). Sophia can suggest a theme, density, and draft voice from on-device signals only: the language you picked, the clock, whether you marked yourself as a manager or family, and which panels you open. It does not read chat text, and it does not send those signals anywhere. A suggestion stays a preview until you approve it. Every approved change is kept as a local version with undo and reset. Accent colors are rejected unless they meet WCAG AA against the page background and as button text. Backgrounds are bundled gradients and patterns, or a PNG, JPEG, or WebP you upload into this browser. Draft voice (formal or friendly, short or detailed, English, Arabic, or mixed) is stored per user and applied to Sophia's meeting drafts and to the on-device prompt. Details: `docs/appearance.md`.

### Agent architecture and action boundaries

The current baseline is a browser-local Qwen3 0.6B ONNX model, existing suggestion and summary flows, a separate streamed companion dialogue, and a debounced client runtime that classifies a few message patterns for fixed private observations. The model returns plain text; it does not currently emit or execute structured tool calls. There is no evidence that this model reliably chooses tools, researches facts, uses Jordanian Arabic naturally, or improves its own weights. Browser speech input may be unavailable without an installed local pack; browser-provider recognition requires a separate opt-in. These are current limitations, not capabilities implied by the companion UI.

The first agent vertical slice adds a typed, allowlisted, in-memory action gateway. It bounds the proposal queue and lifetime, revalidates the selected conversation and recipient before sending, consumes approvals once, and keeps only tool/outcome/time metadata in a bounded session audit (never message text or search queries). Composer submission now stages the exact final message and recipient for a second, explicit **Confirm and send** action. Editing the composer invalidates that approval. Sending still uses the existing encryption and transport paths; the gateway does not bypass them. Sophia can also propose document downloads (real PowerPoint `.pptx` briefing decks for presentations, plus Markdown research briefs and agendas), personal-memory remember/forget, composer drafts, and DuckDuckGo search opens. Presentation decks are generated locally with a technology-forward narrative for the requested subject. None of these run until the user approves the exact staged action. Product surfaces for Settings, Sophia studio, privacy, security, devices, and future subscription tiers live under `/settings` and `/sophia`.

Optional personal memory stores short user-authored notes in this browser only after approval. Notes are bounded, never uploaded for AI inference, and can be disabled or forgotten from Assistant settings. They may be quoted into the local companion prompt as untrusted data when personal memory is enabled.

The companion can optionally perform automatic research for eligible standalone factual/current-information questions. It is off until the user enables **Allow automatic online research** in the companion panel; that preference is saved with the other assistant settings in this browser and can be disabled there. Only the current companion input is sent to the authenticated research endpoint; selected-chat messages, dialogue history, and contact messages are never appended. The app backend forwards the standalone query to Brave Search and returns at most four HTTPS result URLs and bounded snippets. The existing on-device model then writes a brief from those snippets and displays links to the exact returned sources. Retrieved pages/snippets are untrusted input, and the small local model may misstate facts or citations; check important claims against the linked pages.

This feature requires a server-side `BRAVE_SEARCH_API_KEY`; keep it in the backend environment, never in frontend settings or source control. For manual backend startup put it in `backend/.env`; Docker Compose also loads this file into the backend container when it exists. Recreate the backend container after changing the file so it receives the updated environment. Without a key, the endpoint responds that online research is not configured. The query passes through the app backend and Brave Search, as disclosed by the opt-in control. The app's route does not persist the query or log request bodies, but hosting/network infrastructure may have its own access logs. No chat context, companion dialogue, identity, or recipient is sent as part of the search request. Search requests are authenticated and rate-limited. Only result snippets are summarized: full pages are not fetched, source quality is not ranked, and scientific/medical evidence is not specially validated. The earlier explicit DuckDuckGo hand-off also remains available.

### Cloud Sophia

Cloud Sophia stays on the on-device path until a person checks a separate signup consent screen, or the same consent later under Settings → Privacy. The checkbox starts unchecked. A grant stores the account, the time, the purpose text, and version `cloud-sophia-v1`. Withdraw in Settings clears that grant and the API stops calling the hosted model.

Set these in the **repo-root** `.env` that production Compose interpolates. For `npm run dev` in `backend/`, put them in `backend/.env`. Do not put the key in frontend settings or source control. If the key or base URL is unset, `POST /sophia/cloud/complete` returns 503 and does not invent a reply.

- `SOPHIA_MODEL_API_KEY`
- `SOPHIA_MODEL_BASE_URL` (HTTPS, for example `https://api.x.ai/v1`)
- `SOPHIA_MODEL_NAME` (optional; defaults to `grok-4`)

The adapter does not send a training opt-in, and it does not write prompt bodies to application logs. Connected mail, calendar, GitHub, and Linear metadata the person already linked can be included only while consent is on. Decrypted private messages are not sent. This product has no per-thread or per-send authorization that would allow that, and this slice does not decrypt chat for the model.

Settings → Activity records sign-in, this consent, settings changes from these controls, approved email sends, approved email drafts, approved calendar reschedules, and approved calendar deletes. It does not record every button, message bodies, recipients, or tokens. The account owner can export JSON or delete the whole log. Individual rows are not editable.

### URL reputation checks

Message URLs and media captions containing URLs are checked before encryption and sending, and again on each recipient device before the app offers an **Open checked link** action. Checks use Google Safe Browsing through the authenticated backend endpoint. To enable them, create a Google Safe Browsing API key, restrict it to the Safe Browsing API, and set `SAFE_BROWSING_API_KEY` only in the backend environment (or in the production Compose environment). Do not expose the key to frontend settings or source control. Without a key, or when the provider is unavailable, URL-bearing messages cannot be sent and recipient links remain non-clickable; ordinary messages without URLs continue to work.

As disclosed in the chat UI, URL candidates are sent to Google Safe Browsing before E2EE encryption, including URL paths and query strings; do not send private or secret-bearing URLs. Local hostnames, IP literals, and private names are not sent to Google and are treated as unverifiable. Checks are authenticated, rate-limited, briefly cached by a one-way hash in server memory, and neither URL bodies nor provider errors are logged by this route. Only links the provider reports with no known threat are offered as a button; plain text is never auto-linked, and message URLs cannot exceed the check limit. These checks are not a guarantee: new threats, deceptive lookalikes, links that redirect, and vulnerabilities in destination sites can still be dangerous. Verify the displayed hostname and use caution even after a clean result.

The in-app agent has no source-tree, shell, credential, deployment, or arbitrary JavaScript access. Developer-agent work remains a separate future development-environment workflow; an in-product suggestion cannot modify code or install dependencies.

Phased evolution:

1. **A — Agent contracts and execution policy (started):** typed actions, proposal lifecycle, per-action approval, bounds, revalidation, cancellation, metadata-only audit, and failure handling. Tool selection is still user/UI initiated because the current model has no trusted structured tool-call contract.
2. **B — Proactive companion and drafting (partial):** reuse current debounced message observations, dialogue, and drafts; keep send approval exact and mandatory. Next: evaluate a bounded local planner before letting it propose tool requests.
3. **C — Evidence research (partial):** optional automatic Brave Search retrieval and local synthesis with linked source provenance are implemented. Full-page fetching, source-quality ranking, scientific-domain safeguards, and empirical citation accuracy evaluation remain unimplemented.
4. **D — Feedback personalization (not implemented):** session-only feedback is the privacy-preserving next step; no durable learning or model training occurs.
5. **E — Validated UI actions (partial):** the contract allows a small UI action allowlist; current companion presentation remains driven by actual runtime state and user controls.
6. **F — Developer workflow (not implemented):** must be isolated to an authorized development workspace with reviewable diffs and explicit test/build/deploy approvals.

When enabled, a lifecycle-managed local companion runtime observes decrypted message snapshots for the currently open thread. Initial history is treated as baseline, message IDs are deduplicated, short bursts are coalesced, outgoing replies cancel pending observations, and thread/settings changes cancel queued work. A lightweight local heuristic stays quiet on routine text and can show one fixed, tentative observation for a question, coordination, or likely sensitive moment; this filter does not run the language model, transmit text, or log message content. Observation language follows the configured English/Arabic preference; Auto uses a basic Arabic-script check for the triggering message. This is a limited event filter, not semantic understanding or a claim that every meaningful message will be recognized. **Quiet presence** disables proactive observations, **Interactive** allows private visual observations, and **Active voice** speaks a direct companion reply only after the user submits a companion turn and local safety checks pass. Proactive observations themselves are visual only and never speak automatically. The orb reflects actual companion runtime state and respects the app's reduced-motion setting.

Controls for proactive observations, voice output, deliberate microphone activation, and selected-chat context are independent. Disabling chat context clears the transient companion dialogue and cancels an active response. Microphone capture requires enabling the microphone control and pressing **Speak**. This integrated browser reported no installed local speech model; users can either type/use their operating system's dictation or separately opt into browser-provider recognition after reading the audio disclosure. Active voice output uses browser speech synthesis, and available voices/languages vary. Automatic speech filters are best-effort pattern checks, not a semantic privacy classifier; choose silent mode or use **Speak** manually when any possibility of audio disclosure is unacceptable.

Companion dialogue runs in a browser worker and streams text chunks from the local model. The current dialogue is kept in page memory only, scoped to the open thread, and cleared when leaving the thread or pressing **Clear**. It is not persisted as long-term dialogue memory. Separate optional personal notes are stored in this browser after approval when personal memory is enabled. Recent selected-chat context is separately controlled by a checkbox and bounded to six messages / 1,600 characters; contact messages are JSON-quoted untrusted data, never instructions. Unchecking context keeps contact transcript text out of companion prompts. The companion and context are not sent to the API, analytics, logs, or external model inference. Local speech input is used only if the browser reports an installed on-device recognition model; the app requires `processLocally` and does not install missing packs. If none is available, the user may separately opt in to the browser speech service. That explicit option warns that audio and transcripts may be processed by the browser's provider; its identity and processing location depend on the browser. It is off by default. Microphone capture starts only after enabling the microphone control and pressing **Speak**. Speech is transcribed into the editable companion input and is not submitted automatically. Addressing Sophia by name with a compound task uses the fast planner; otherwise free-form turns still use the local model.

Inference uses the Transformers.js-compatible ONNX model `onnx-community/Qwen3-0.6B-ONNX` (Qwen3, 0.6B parameters, Apache-2.0), pinned to a model revision. This is a compatibility-and-size choice for local browser inference, not a claim that its reply quality has been benchmarked as better. Qwen3 supports a wider set of languages than Qwen2.5 according to the model cards; practical quality for colloquial Arabic, Jordanian/Levantine dialects, slang, humor, and code-switching is not guaranteed. The larger Qwen3 1.7B quantized option is approximately 1.43 GB and was not selected because its first-use download and memory requirements are substantially higher. The earlier Qwen2.5 0.5B option was approximately 483 MB, but its model card advertises fewer languages.

Before inference, the app bounds context to the 16 most recent messages and 4,000 characters in the selected conversation. Transcript text is treated as untrusted data. There is no cloud inference or remote fallback: model files are downloaded from Hugging Face, but prompts and decrypted messages are not. After model files are cached, inference can run offline. The app does not send decrypted messages, prompts, summaries, or keys to the API or an AI provider, and it does not persist suggestions or prompts. Browser-managed model weights remain cached.

WebGPU is used when available; otherwise the runtime uses WebAssembly on the CPU. If WebGPU initialization or generation fails, the worker retries once on WASM and clears any partial streamed text before the recovery attempt; CPU inference can be slower. Companion output is capped at 128 new tokens, and selected-chat context is limited to six messages / 1,600 characters to reduce inference work. Retry resets the failed worker and starts a fresh local inference attempt; downloaded model weights use the browser cache, so retry does not intentionally redownload them. Either execution path can still fail on devices with insufficient memory or unsupported browser features. Model initialization and inference run in a worker; companion generation streams, can be stopped, and obsolete work is cancelled. This Qwen3 0.6B model is a small, resource-conscious model selected for browser compatibility, not an evidenced high-capability companion model. No live multi-turn quality, inference latency, or memory benchmark has been run on this device, and the model can miss intent, repeat itself, or misunderstand Arabic dialect and mixed-language messages. It is not established as adequate for a convincingly natural conversational companion. An unavailable or failed assistant does not block normal messaging.

The repeatable companion evaluation set in `frontend/lib/ai/companion-evaluation.ts` covers English dialogue and follow-ups, Arabic, Jordanian/Levantine Arabic, code-switching, humor, serious support, ambiguity, drafting, and hallucination resistance. Automated tests verify that each fixture produces a correctly bounded prompt; they do not measure answer quality. The fixtures have not been run as a live model-quality benchmark: model weights were not downloaded and no response quality or latency measurements are available. Review generated content for accuracy and tone before using it.

`npm run eval:assistant -- --mode=mock` (from `frontend/`) wires those fixtures together with English and Levantine manager cases for email triage, drafting, and scheduling, and writes `frontend/reports/assistant-eval.md`. Mock mode needs no API key and only checks the harness. `--mode=live` calls `SOPHIA_MODEL_BASE_URL` when `SOPHIA_MODEL_API_KEY` is set and fails if the average score is under 0.8. Without those variables, `--mode=live` or `--mode=skip` exits successfully and says the live eval was skipped. Because no live run has cleared that bar, the product shows an **Experimental** label on Sophia.

The web app UI is available in English and Arabic. Arabic sets `dir="rtl"` on the document, keeps emails, usernames, and URLs in isolated left-to-right runs, and stores the choice in this browser. A web app manifest and service worker make the site installable. Mobile layout is covered by Playwright at iPhone and Pixel widths in both languages.

Conversation summaries remain available as a secondary, collapsible on-device tool. Very short exchanges (up to three messages and 280 characters) use a deterministic summary rather than loading the language model; longer summaries use the same local model. Automatic summary language selection is a basic dominant-script heuristic, not full language detection.

### Voice companion

Voice is an optional layer over the existing suggestions, not a separate chatbot. The modes are silent, speak only when the user taps **Listen**, and automatic speech of at most one safe suggestion for a newly received message. History present when a conversation opens is not automatically spoken. Suggestions remain visible and editable, and voice never sends or inserts a message. Voice mode, mute, voice selection, and speech rate (0.7x–1.3x) are stored locally. Stop, conversation changes, assistant disablement, switching to silent or mute, backgrounding the tab, and other page audio cancel current speech. Automatic speech is skipped while the tab is not visible or another media element/browser speech is active. The app does not create voice notifications.

The replaceable `TextToSpeechProvider` currently uses the browser Web Speech API and only voices whose platform reports `localService: true`. It does not submit utterance text to an external TTS provider; no neural TTS model is currently downloaded or used. This local-service signal is the browser's indicator, not an independently audited guarantee about every operating system voice implementation.

Actual inspection in the integrated desktop browser (Windows, Electron 43 / Chromium 150) found the Speech Synthesis API and three local English (US) voices (Microsoft David, Mark, and Zira) after `voiceschanged`; it exposed no Arabic voice. This was voice enumeration only: spoken quality and pronunciation were not listened to or scored. Other browsers and user devices were not available for testing, so voice availability and quality vary by platform. Without an installed local Arabic voice, Arabic speech will be unavailable rather than falling back to a remote service.

Automatic speech is deliberately narrow: it requires the recent context and the chosen reply to match a small allowlist of neutral greetings, simple availability/scheduling, and brief acknowledgements. It also blocks explicit sensitive-topic, account-secret, URL, phone, and email patterns. Other suggestions stay visible and can still be read by tapping **Listen**. The allowlist and pattern checks are not a semantic privacy classifier and cannot guarantee detection of every sensitive situation. Automatic mode is off by default; use silent or tap-to-speak after reviewing a suggestion when any possibility of speaking aloud is inappropriate.

Future local-neural options were compared, but not added because native speech works for English in the inspected browser and neural Arabic quality/license/runtime have not been established. [Kokoro ONNX](https://huggingface.co/onnx-community/Kokoro-82M-ONNX) has browser-oriented JavaScript/ONNX support and Apache-2.0 metadata; its model card lists English voices and reports 86 MB for q8-f16 and 92.4 MB for q8, so it does not solve Arabic coverage. [Piper's Jordanian Arabic Kareem medium voice](https://huggingface.co/rhasspy/piper-voices/tree/main/ar/ar_JO/kareem/medium) is 63,201,294 bytes (~63.2 MB), 22.05 kHz, and marked medium quality; its model card points to the training dataset for licensing rather than establishing a clear redistributable voice license. Piper would also require an in-browser ONNX/phonemizer/audio pipeline. Neither candidate's naturalness, speed, memory use, or Jordanian pronunciation was tested here. Reconsider only after a license audit and local-device evaluation against native voices.

### Safety numbers

On unless `SAFETY_NUMBERS_ENABLED` or `NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED` is exactly `false`. Settings → Security shows a 60-digit safety number for each direct chat and each group, computed in the browser from the active device identity keys. The first time this browser sees a chat it is not a warning. A later change to those keys is. Marking a number verified stores that choice in this browser only. The API route returns public keys to conversation members and does not consume one-time prekeys. `GET /health` reports `safetyNumbers`. No database migration. Details: `docs/safety-numbers.md`.

## Workspaces and plans

Families and teams live in a workspace with an owner, admins, and members. Members find each other there and open the same end-to-end encrypted chats; the API still stores ciphertext only. Invites are single-use expiring links. The code is hashed at rest and is not emailed. Seat limits and the manager daily brief are enforced from `backend/src/plans.ts`. Billing is off unless `BILLING_ENABLED=true`. Details: [docs/workspaces.md](docs/workspaces.md) and [docs/billing.md](docs/billing.md).

After pulling this change, create the new tables once:

```bash
cd backend
npx prisma db push
```

## Security docs

- [Vulnerability reporting](docs/SECURITY.md)
- [Threat model and AI boundary](docs/THREAT_MODEL.md)
- [Backup and new-device recovery drill](docs/RECOVERY.md)
- [Safety numbers](docs/safety-numbers.md)

## Account security and recovery

- Signup requires a matching password confirmation and an authenticator-app TOTP factor. Save the one-time recovery codes shown after enrollment.
- Login requires the password and a current TOTP or unused recovery code. Sessions are stored server-side, expire after seven days, and are revoked at logout or password reset.
- The browser stores a non-exportable vault-unwrapping CryptoKey for convenience. This avoids re-entering the password on refresh while the account session remains active, but weakens protection against someone who can access the already signed-in browser profile or execute same-origin script. Sign out before leaving a shared device; sign-out deletes the remembered key.
- The password reset email link expires after 30 minutes and also requires the account's TOTP or an unused recovery code.
- Password reset revokes all sessions and devices and increments the vault version. The next login creates a new independent device vault. Existing archived message history remains recoverable with the saved history recovery code; without it, the old password is still needed. Old device identities and ratchet states are never restored onto the new device.
- Configure `TOTP_ENCRYPTION_KEY` as 64 hex characters (32 random bytes) and `JWT_SECRET` as a high-entropy value of at least 32 characters. Keep the TOTP key stable and backed up across deployments; losing or changing it prevents users from authenticating with their existing factors and makes stored integration refresh tokens undecryptable. Do not commit either value. Development Compose does not embed one. A key that previously lived in `docker-compose.yml` is still in git history; treat it as public and do not use it.

Password recovery email delivery uses the Gmail API. In Google Cloud, enable the Gmail API and create OAuth credentials with the `https://www.googleapis.com/auth/gmail.send` scope. Generate a refresh token for the sending mailbox, then set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and `GMAIL_SENDER`. Leave all four unset to disable recovery email sending. For production Compose, also set `FRONTEND_ORIGIN` and `NEXT_PUBLIC_API_URL` to the public HTTPS origins; secure cookies are enabled by default.

### Calendar & email OAuth (Phase 2)

Per-user Google/Outlook **calendar** and **mail** connect lives under Settings → Integrations.

- Calendar: `API_PUBLIC_ORIGIN`, `GOOGLE_CALENDAR_CLIENT_*`, `MICROSOFT_CALENDAR_CLIENT_*` — see `docs/phase2-calendar-oauth.md`
- Mail (separate from recovery-sender `GMAIL_*`): `GOOGLE_MAIL_CLIENT_*`, `MICROSOFT_MAIL_CLIENT_*` — see `docs/phase2-email-oauth.md`

Redirect URIs use `{API_PUBLIC_ORIGIN}/integrations/calendar/.../callback` and `/integrations/email/.../callback`. Phase 4.2 scopes include calendar/mail **write** (events / drafts); users must reconsent after console upgrades. Refresh tokens are encrypted at rest. Calendar mirrors titles/times; mail mirrors subject/from/snippet (not full bodies). Connecting does not authorize Sophia AI over that data. Leave vars empty to keep Connect disabled (API 503). These paths never receive chat plaintext.

### GitHub & Linear OAuth (Phase 3)

Per-user **GitHub** / **Linear** work-item connect is on the same Integrations page.

- `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`, `LINEAR_OAUTH_CLIENT_ID` / `LINEAR_OAUTH_CLIENT_SECRET`, plus shared `API_PUBLIC_ORIGIN` — see `docs/phase3-github-linear-oauth.md`

Redirect URIs: `{API_PUBLIC_ORIGIN}/integrations/work/github|linear/callback`. Scopes: GitHub `read:user`+`repo`; Linear `read`+`write`. Mirrors store title/state/url/number only (no issue bodies). Tokens encrypted at rest; connect ≠ AI consent; chat E2EE untouched.

### Slack collab OAuth (Phase 3)

- `SLACK_OAUTH_CLIENT_ID` / `SLACK_OAUTH_CLIENT_SECRET` + `API_PUBLIC_ORIGIN` — see `docs/phase3-slack-oauth.md`
- Redirect: `{API_PUBLIC_ORIGIN}/integrations/collab/slack/callback`
- User scopes: `channels:read`, `groups:read`, `users:read`, `chat:write` (no message history). Channel name/id mirrors only.

### Provider write APIs (Phase 4.2)

Owner-scoped Fastify write routes accept **already-approved structured payloads** for GitHub, Linear, and Slack, and for creating a calendar event. Master flag `INTEGRATIONS_WRITE_ENABLED` defaults to `false` in production config. Settings → Integrations shows **Upgrade permissions** when a connection is missing write scopes. Details: `docs/phase4-write-oauth.md`.

Sending mail, saving a draft, rescheduling an event, and deleting an event do not run on those direct routes. Sophia stages the action locally. Approving it proposes the exact payload on the server (a hash only; the body is not stored) and then calls `POST /integrations/writes/proposals/:id/approve`. That approve call is the only path that talks to Gmail, Outlook, Google Calendar, or Microsoft Graph for those four actions. Approving the same proposal again returns the first result and does not send or delete a second time. Each successful execution appends one activity-log row. Nothing in this path runs without that explicit approve call.

#### Enable writes for one dogfood account

Leave the flag off for everyone else. Production Compose sets `INTEGRATIONS_WRITE_ENABLED` to `false` unless the repo-root `.env` overrides it.

1. Find the account. From the API database: `select id, email, username from "User" where email = 'dogfood@example.com';`
2. In the repo-root `.env` used by production Compose, set both of these. The allowlist does nothing while the flag is false. Use the user id, username, or email. One entry is enough:

```bash
INTEGRATIONS_WRITE_ENABLED=true
INTEGRATIONS_WRITE_ALLOWLIST=dogfood@example.com
```

3. Recreate the API container so it picks up the variables. Startup runs `prisma db push`, which creates the approval table. Other accounts still receive `writes_not_enabled_for_user`.
4. That person reconnects Gmail or Outlook (and Google or Microsoft calendar) from Settings → Integrations so the write scopes are on the connection.
5. In Sophia, stage a send and click the explicit Approve control once. Confirm the message arrives, Settings → Activity shows one "Email sent" row, and repeating the approve request returns the original result without a second message.

To turn it back off, set `INTEGRATIONS_WRITE_ENABLED=false` and recreate the API container. Pending proposals then fail closed and do not send.

### Manager daily brief

On unless `DAILY_BRIEF_ENABLED` or `NEXT_PUBLIC_DAILY_BRIEF_ENABLED` is exactly `false`. After the time the person sets, Sophia prepares a short brief from connected mail and calendar only: today's meetings and prep notes, conflicts, emails that need a reply, overdue follow-ups, and suggested actions. If nothing is connected, the brief asks them to connect mail or a calendar and does not error. A draft, a reschedule, and a decline each wait for the same explicit approval as any other mail or calendar write. `INTEGRATIONS_WRITE_ENABLED` stays off until an operator turns it on. Encrypted chats are not included. Without a Cloud Sophia consent and model key, the wording is deterministic and no model is called. Details: `docs/daily-brief.md`.

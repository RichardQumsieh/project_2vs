# Threat model

This describes the trust boundaries of the code in this repository. It matches the README and the implementation. It is not a claim that a malicious server, a modified web app, or a compromised browser is safe.

The product protects message contents against someone who can read the database and object storage, and who does not also control the frontend the browser runs or the unlocked device. It does not protect against the operator of the service if that operator changes the JavaScript the browser executes.

## Assets

- Chat plaintext, media plaintext, and location coordinates.
- Device identity keys and Double Ratchet state.
- The account archive private key and the history recovery code.
- Account password, TOTP secret, TOTP recovery codes, and session cookies.
- OAuth refresh tokens for mail, calendar, GitHub, Linear, and Slack.
- Connected-mail and calendar text that the server stores in order to show it.
- Cloud Sophia prompts, when that opt-in is on.

## What the server stores and can read

The API is a Fastify process. It does not implement the Double Ratchet and it does not decrypt chat.

It does store and can read:

- Email, username, display name, and an Argon2id password hash.
- Device public keys, signed prekeys, one-time prekeys, and signatures.
- Message ciphertext, nonces, and the client-supplied ratchet header. The header is metadata the other device needs (ratchet public key, counters, recipient). The server stores it and fans it out through Redis and WebSockets. It does not interpret it as message text. A modified client could put extra data in the header, and the server would store that too.
- Account-archive ciphertext. The same limit applies: the server stores opaque bytes.
- The archive private key wrapped under the password and, separately, under the history recovery code. Both wraps are AES-GCM with a PBKDF2 key derived in the browser (310,000 iterations). The server cannot unwrap them without the password or the recovery code. Because the password wrap is in the database, a database thief can guess passwords offline. Use a unique password.
- A SHA-256 hash of the history recovery code. The signed-in client sends that hash to authorize replacing the password wrap after a password change. The hash does not decrypt the archive. It is still a bearer value for that authorization and must not be logged.
- Session rows and an HS256 session JWT in an HttpOnly cookie. The server holds `JWT_SECRET` and can mint or verify sessions.
- TOTP secrets encrypted at rest with `TOTP_ENCRYPTION_KEY`. The server holds that key and decrypts the secret to check a code. A server compromise exposes TOTP secrets. TOTP is not end-to-end encrypted.
- OAuth refresh tokens encrypted with the same key. The server decrypts them to call Google, Microsoft, GitHub, Linear, and Slack. Connecting an integration means the server can read the scopes that connection grants.
- Calendar titles and times, mail subject/from/snippet (and message bodies when the user opens a message through the integration read API), and GitHub/Linear title/state/url/number. Those are not chat ciphertext.
- Trusted-browser token hashes and a coarse IP-network prefix. The raw trusted-browser token is only in an HttpOnly cookie.
- WebRTC signaling (offer, answer, ICE candidates). Call audio and video are DTLS-SRTP between the browsers. The API does not receive the media. STUN and an optional TURN relay can learn the participants' network addresses. The TURN shared secret stays on the server.
- Upload authorization for Backblaze B2. Media bytes uploaded there are ciphertext. The API signs download URLs. It does not receive media keys.

Authenticated clients download their own wrapped archive key. Anyone with a valid session for that account receives the ciphertext wraps. They still need the password or recovery code to open them.

## What an honest client does not send

The shipped frontend encrypts chat, media, voice notes, files, and locations before they leave the browser. The send schema accepts ciphertext envelopes and rejects an extra top-level `plaintext` field. Decrypted chat is not a field on the message API.

That is a property of this client, not a property the server can prove about every caller. The server cannot see inside ciphertext, and it also cannot stop a different client from uploading the wrong thing.

## Archive key

Each account has one long-lived X25519 archive key. Messages are encrypted to each active device's ratchet and also to this archive key. The archive copy is for recovery. It is not a forward-secret ratchet. Whoever has the unwrapped archive private key can read that account's archived messages.

A new device creates its own identity and its own ratchets. It does not import another device's vault or ratchet state. History that no unlocked device ever archived cannot be reconstructed.

Losing both the password and the history recovery code means the archive cannot be opened. The server has no escrow. The optional Google Drive backup is another ciphertext of the same private key, encrypted in the browser with the recovery code, in the user's hidden `appDataFolder`. Google does not get the code. The backup does not help if the code is lost. It also does not help if the browser or the frontend is malicious: that environment sees the key before encryption.

The Drive client id in `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` is a public OAuth client id, not a client secret.

## Frontend and device trust

The browser is inside the trust boundary:

- Private keys are wrapped with PBKDF2 and AES-GCM and stored in IndexedDB.
- After a successful unlock, this browser also keeps a non-exportable wrapping `CryptoKey` in IndexedDB so a refresh does not ask for the password again. Any same-origin script, or anyone who can use that already-unlocked profile, can ask the browser to decrypt. Sign out deletes the remembered key.
- The application server delivers the JavaScript. A compromised or malicious server can ship a build that exfiltrates keys and plaintext. Content-Security-Policy, `X-Frame-Options`, `nosniff`, and HSTS reduce injection and downgrade risk. They do not make the server a hostile-proof client.
- Dependency, browser, and operating-system bugs are outside the archive design.

WebRTC and geolocation need the page to be a secure context in production. Opening a shared location in OpenStreetMap sends coordinates to that provider. The app does not load map tiles by itself.

## AI boundary

Two paths exist. They are not the same, and cloud is not a silent fallback for the local model.

### On the device, by default

- Suggested replies, summaries, companion dialogue, and the local planner run in the browser. The companion model is `onnx-community/Qwen3-0.6B-ONNX`, loaded through Transformers.js. Weights may be downloaded from Hugging Face. Prompts and decrypted messages are not sent to Hugging Face or to the API for that inference.
- Voice notes are transcribed in the browser by a Whisper model. Audio is not uploaded for transcription. The encrypted audio file may be uploaded as ciphertext.
- Browser speech recognition is used only when the browser reports a local engine (`processLocally`). A separate, labeled opt-in can use the browser's own speech service. That service may send audio to the browser vendor. It is off until the user turns it on. Text-to-speech uses voices the browser marks `localService: true`. That flag is the browser's claim, not an audit of the operating system.
- Personal notes stay in this browser. They are not uploaded for inference.
- The in-app assistant cannot read the source tree, run a shell, or deploy.

Local inference can fail. There is no automatic cloud fallback when it does.

### Opt-in, and the server does see it

- **Automatic research.** Off until enabled. The current companion input is sent to the authenticated API, which sends it to Brave Search when `BRAVE_SEARCH_API_KEY` is set. Selected-chat messages are not appended. The API is written not to log the query body. Hosting and Brave can still see the query.
- **URL checks.** Before a message with a URL is encrypted, and again before a recipient is offered an open button, the URL (including path and query) is sent to Google Safe Browsing through the API when `SAFE_BROWSING_API_KEY` is set. Private or secret-bearing URLs should not be sent. Local and IP-literal hosts are not sent to Google.
- **Cloud Sophia.** Off until the person checks a separate consent control (signup or Settings → Privacy). The API then sends that person's prompt, plus connected mail, calendar, GitHub, and Linear metadata, to `SOPHIA_MODEL_BASE_URL` using `SOPHIA_MODEL_API_KEY`. The request body must be only `{ "prompt": string }`. Bodies that include `plaintext`, `ciphertext`, `messages`, or the other private-message keys are rejected. Decrypted chats are not attached. The shipped UI does not put them in the prompt. The server cannot tell whether a person pasted chat text into the prompt. If the key or base URL is unset, the route returns 503 and does not invent a reply. The adapter does not send a training opt-in. Application logs for this call record user id, outcome, and status, not the prompt. The model host still receives the prompt and the connected metadata.

Connected integrations do not by themselves grant the model access. Cloud consent does.

## Transport, cookies, and logs

- The API listens on HTTP. Production TLS is terminated at a reverse proxy. Browsers need HTTPS for secure cookies, microphone, camera, and HSTS.
- Session and trusted-browser cookies are `HttpOnly` and `Path=/`. When `COOKIE_SECURE` is true they are `Secure` and `SameSite=None`, which is what a cross-site SPA needs. When it is false (local HTTP) they are `SameSite=Lax`. `NODE_ENV=production` refuses to start if `COOKIE_SECURE` is false. Production Compose sets `COOKIE_SECURE=true`.
- `TRUST_PROXY` defaults to off. `X-Forwarded-For` and `X-Forwarded-Proto` are ignored, so a client cannot spoof its address. Set it to the proxy's IP or CIDR only. The value `true` is rejected. With it unset behind a proxy, every client shares the proxy address: auth rate limits share one bucket, trusted-browser network checks see the proxy, and HSTS is not emitted because the app still sees HTTP. HSTS (`max-age=15552000`, without `includeSubDomains`) is set only when Fastify considers the request HTTPS.
- API responses also set `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a `default-src 'none'` content security policy, and a locked-down permissions policy. The Next.js app sets its own content security policy (nonce, no inline scripts; `unsafe-eval` only in development), frame denial, and a permissions policy that allows camera, microphone, and geolocation for the app itself. The document HSTS header is sent when the page is HTTPS. `Cross-Origin-Resource-Policy` is not forced on the API, because the SPA is a different site and must be allowed to read credentialed responses. CORS allows only `FRONTEND_ORIGIN`.
- Auth routes are rate limited per IP: register 5, login 10, TOTP confirm 10, forgot-password 5, reset 5, logout 30, each per 15 minutes, with a global 120/minute backstop. Limits are only as good as `request.ip`.
- The process logger drops request bodies, chat plaintext, ciphertext, MLS `payload` bytes, prompts, passwords, tokens, cookies, and authorization headers, and it strips URL userinfo. A handler that interpolates message text into a log line is still a bug; the sanitizer removes sensitive field values of 12 characters or more from that line when those values were on the same log call. Infrastructure access logs, proxy logs, and the model host are outside this process.

## Out of scope

- A fully compromised API or a replaced frontend.
- A person who already has the unlocked browser profile, the password, or the recovery code.
- Malware on the device, or a stolen unlocked phone.
- Traffic analysis, who talks to whom, and timing. The server sees accounts, devices, conversation membership, and ciphertext sizes.
- Provider-side retention at Brave, Google Safe Browsing, Hugging Face (model downloads), STUN/TURN, Backblaze, or the cloud model host.
- Safety of downloaded files. The server cannot scan plaintext. The client checks are not antivirus.

## Related documents

- [Vulnerability reporting](SECURITY.md)
- [Backup and new-device recovery drill](RECOVERY.md)

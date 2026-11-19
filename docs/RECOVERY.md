# Backup and new-device recovery drill

This is the drill for getting message history onto a new browser. It follows the code, not an ideal protocol. Automated coverage is listed at the end. The parts that need a live server, a mailbox, or Google are manual.

## What you must already have

Save these when the account is created. The history recovery code is shown once, in the inbox, before you can continue.

| Item | What it unlocks | What it does not unlock |
| --- | --- | --- |
| Password | This device's vault, and the password wrap of the archive key | Another device's ratchet. After a reset, the old password wrap no longer matches. |
| History recovery code | The recovery wrap of the archive private key, and the optional Drive backup of that key | The code itself, if you lose it. Nothing on the server can replace it. |
| Authenticator app, or a one-time TOTP recovery code | Sign-in, and the password-reset form | Archive history. TOTP recovery codes do not open the archive and do not mark a browser trusted. |
| Optional Google Drive backup | A second ciphertext of the archive private key, in that Google account's hidden app-data folder | History, unless you also have the recovery code. Google does not have the code. |

The server stores the wrapped archive key and a SHA-256 hash of the recovery code. It does not store the code or the unwrapped key. Device vaults stay in the browser. A new device generates a new identity and new ratchets. It never copies the old device's live ratchet.

Messages that were never archived by an unlocked device are gone. The archive is not forward secret: the recovery code reveals every archived message, not only new ones.

## Before the drill

Use a test account. Do not practice by resetting a production account you care about until you have confirmed the recovery code opens a second browser.

1. Create an account. Copy the history recovery code and store it outside the browser. Copy the TOTP recovery codes too.
2. Unlock the inbox and confirm the history-recovery prompt was accepted.
3. Optional: open Settings (`/settings`), section **Encrypted Google Drive backup**. Enter the same history recovery code and use **Back up to Google Drive**. This build shows that control only when `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` is set.
4. Send a distinctive message from this browser to a second test account, and confirm the other account can read it.
5. If you will test password reset, configure the Gmail sender (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`) and `FRONTEND_ORIGIN`. If those are unset, **Forgot password?** returns 503 and says recovery email is not configured. The archive drill below does not need email.

## Drill A — new browser, same password

1. Open a clean browser profile.
2. Sign in with email, password, and TOTP. Trusting the browser is optional and does not restore history.
3. The new profile creates its own device. It downloads the wrapped archive key and unwraps it with the password.
4. Open the conversation. Archived history for messages this account could archive should decrypt locally.

Expected: the distinctive message is readable. The new device is a new device id. The other account does not need to do anything for archive history you already have. New messages you send use the new ratchet; the other account encrypts to your new device the next time it sends.

Failure: if the password wrap does not open, the UI asks for the history recovery code (the Google Drive recovery-code field on the sign-in form). That is Drill B, not a successful password unlock.

## Drill B — password no longer opens the archive

This is the path after a password reset, or when this browser never had the old password wrap.

1. If you are testing reset: from the sign-in form choose **Forgot password?**, open the link (it expires after 30 minutes), and submit a new password plus a current TOTP or an unused TOTP recovery code.
2. Reset revokes sessions, trusted browsers, and messaging devices, and the next sign-in creates a new device vault. Old ratchet state is not restored. The reset screen says that.
3. Sign in with the new password and TOTP.
4. When this device cannot open history with the password, enter the history recovery code. The field is **Google Drive recovery code**. The code is used locally. It is not sent as the code itself. The client derives the archive key, re-wraps it under the new password, and sends the hash of the code so the API will store the new password wrap.
5. If you saved a Drive backup and this build has the Google client id, use **Restore from Google Drive**, connect the same Google account, and enter the same code. The backup decrypts in the browser. If the server already has an archive key, the restored key must match it. If the server record is missing, the backup can recreate it without changing the archive key.
6. Open the conversation and confirm the distinctive archived message decrypts.

Expected: history is back. The old device's identity is not. The other participant's device list for you is the new device only.

Failure you should treat as final for that history:

- The recovery code is wrong or lost, and the Drive backup is missing or was encrypted to a code you do not have. There is no administrator unlock.
- The message was sent before any of your devices archived it. Later devices cannot invent that plaintext.

A wrong code fails closed. The automated test expects `INVALID_ARCHIVE_RECOVERY_CODE` for the account wrap and a decrypt error for the Drive backup.

## Drill C — confirm the server did not learn the plaintext

On the API host, while Drill A or B sends and restores the distinctive message:

1. Watch the API process logs.
2. Search for the distinctive phrase.

Expected: the phrase is absent. Logs may show routes, status codes, and ids. They must not show the message text, the recovery code, or the session cookie. The automated test posts a canary plaintext through the message path and checks the logger output.

Proxy and hosting logs are separate. This drill only covers the application logger.

## After the drill

- Sign out of the test profile you do not want to keep. Sign-out drops the remembered vault key and the session. It does not delete the recovery code you saved, and it does not remove browser trust. Password reset does remove browser trust.
- If the recovery code was displayed on a shared screen, generate a new account for anything real. The product does not rotate the archive key in place.
- If `TOTP_ENCRYPTION_KEY` or `JWT_SECRET` from an old development Compose file was ever used on a real database, rotate them. History still contains the old development values; this drill does not rewrite git history. Changing `TOTP_ENCRYPTION_KEY` makes existing TOTP secrets and integration refresh tokens undecryptable, so users must enroll again and reconnect integrations.

## Automated coverage

These tests run in CI. They do not send email, talk to Google, or boot Postgres.

- `frontend/lib/crypto/recovery-drill.test.ts` — new password plus recovery code unwraps the same archive key, decrypts an archived message, rejects the wrong code, and does not carry the old device signing key. A second case restores that key from the Drive ciphertext.
- `frontend/lib/crypto/account-archive.test.ts` — password unlock, Drive backup mismatch, and archive authenticated encryption.
- `frontend/lib/crypto/device-backup.test.ts` — device-scoped backup records do not decrypt under another device or password. Those records are not how a new device clones identity.
- `backend/tests/device-recovery.test.ts` — archive and device-backup payloads are bounded ciphertext, and the recovery-code hash check accepts only the same hash.
- `backend/tests/security-hardening.test.ts` — a decrypted canary placed on a message request does not appear in server logs.

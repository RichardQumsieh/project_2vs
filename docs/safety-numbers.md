# Safety numbers

Sophia encrypts each direct message to every active device, and each device has its own identity keys. A new phone, a password reset, and a server that registers an extra device all look the same in the chat list: another public key. Safety numbers give the two people a short number they can compare outside the app. The number changes when those public keys change.

This is the check a family or a company can actually do before they trust a new laptop. It does not fix a stalled MLS group, and it does not make a modified copy of the app honest. Those limits are below.

The feature is off unless both flags are exactly `true`.

| Variable | Where | Effect |
| --- | --- | --- |
| `SAFETY_NUMBERS_ENABLED` | API | `503 safety_numbers_disabled` on `GET /conversations/:id/identity-keys` |
| `NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED` | Web client | Settings → Security hides the panel. The client does not call the directory. |

`GET /health` reports `safetyNumbers` so an operator can see the API switch. Production Compose and the production image default both flags to false. Turning the client flag on requires restarting `next dev` or rebuilding the image, because Next inlines `NEXT_PUBLIC_*` at start.

No database migration. The route reads devices and membership that already exist.

## What you compare

Open **Settings → Security** while both flags are on and this browser is signed in. Each direct chat and each group has one 60-digit number, shown as 12 groups of 5, and a QR code of that number only.

- A direct number is a hash of both people's active device identity keys and signing keys. Both screens show the same number. It does not matter who opens the page.
- A group number is a hash of every current member's active device keys. Adding, removing, or replacing a device changes it.
- Device display names are not part of the hash. Renaming a phone does not warn.
- The first time this browser sees a complete directory, the chat is **Not checked**. That is trust on first use. It is not a warning.
- If the directory later changes, the chat is **Key changed** until you review it. **Mark as verified** means you compared this number and it matched. **Accept new keys** clears the warning and removes verified. A new phone is expected to look like a key change. Compare it once.
- Verified is stored in this browser only (`sophia-safety-review:v1:<userId>`). It is not sent to the server, and it is not a message.
- If the server's copy of this browser's own identity keys does not match the unlocked vault, the page says so and will not let you mark the number verified.
- If a member has more than 32 active devices, the conversation has more than 8 members, or a stored key is not 32 bytes, the page shows **Incomplete** and does not offer a number. A partial list could hide a device, so it is not hashed.

The directory is `GET /conversations/:id/identity-keys`. You must be a member. Someone who is not gets the same 404 as a missing conversation. The response is public keys, device ids, and display names. It does not consume one-time prekeys, and it does not include signed prekeys, archive keys, ciphertext, or private keys. Responses are `Cache-Control: no-store`.

The QR payload is `sophia-safety-number/v1:` plus the 60 digits. It is not a key and not a login.

## What this does not do

- It does not prove the server delivered the app you think you are running. A modified frontend can hide a warning. Comparing the number on a call or in person is the check.
- It does not authenticate an MLS committer. A crafted commit can still occupy an epoch and stall a group. See `docs/group-e2ee.md`.
- It does not change encryption. Messages still use the Double Ratchet for direct chats and MLS for groups.
- It is not a backup and it does not recover history. A new device still needs the history recovery code for old archive messages, and that new device changes the safety number.
- Lost verification state in this browser does not delete messages. The next visit starts from Not checked again only if the saved record is gone. If the record is still there and the keys match, verified stays.

## Enable it for a design partner

1. In the API environment (`backend/.env`, or the repo-root `.env` that Compose interpolates), set `SAFETY_NUMBERS_ENABLED=true`.
2. In the environment that starts Next, set `NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED=true`. For Compose, that is the repo-root `.env`. For `npm run dev` inside `frontend/`, put it in `frontend/.env.local`.
3. Restart the API and the Next process. Recreate the containers if you use Compose. A production image has to be rebuilt so the client flag is inlined.
4. Sign in, open Settings → Security, and compare a number with the other account. `GET /health` should show `"safetyNumbers": true`.

To turn it off, set both flags back to `false` and restart. The API then returns 503 and does not list the directory. Pending local verified bits stay in the browser and are unused until the flags are on again.

## Tests

- `frontend/lib/crypto/safety-number.test.ts` — both people see the same direct number, group order does not matter, and a new key, signing key, device id, or device changes the number.
- `frontend/lib/crypto/safety-review.test.ts` — first sight is unverified, a later change warns without forgetting the old keys, accept drops verified, corrupt storage is ignored.
- `frontend/lib/crypto/safety-view.test.ts` — a peer key change can be accepted, a mismatch with this browser blocks verify, and an incomplete directory is not hashed.
- `backend/tests/safety-numbers.test.ts` — the flag defaults off, a non-member is a 404, the JSON has only public fields, and a truncated or unreadable key list returns no keys.
- `frontend/e2e/safety-numbers.spec.ts` — English and Arabic at iPhone and Pixel width. The preview warns, the number stays left-to-right, and marking verified does not POST.

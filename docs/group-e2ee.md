# Small-group end-to-end encryption

Sophia already encrypts 1:1 chats with X3DH and a Double Ratchet. The Prisma `ConversationType.GROUP` value existed, but a group message had no group key schedule: the server could only store pairwise envelopes. This prototype adds real group encryption for a small set of members (a company leadership group, up to 8 people, 2 devices each).

The server stores opaque MLS bytes and the membership list. It does not receive plaintext, message keys, or MLS private state.

## Decision

**Use MLS (RFC 9420) through `ts-mls` 1.6.4, cipher suite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`.** Do not ship sender keys, and do not ship the published OpenMLS WASM package.

The client wrapper is `frontend/lib/crypto/group-mls.ts`. It imports `ts-mls` submodules rather than the package barrel, so the Noble-only cipher suites are not loaded. Cipher suite 1 uses Web Crypto (Ed25519, HKDF, AES-GCM) and `@hpke/core`, which is already how ts-mls implements that suite. The wrapper is pinned to the 1.6.4 positional API. The upstream README on `main` has since moved to an object API; upgrading the package is a deliberate change, not a floating minor bump.

### Why not OpenMLS via WASM

OpenMLS itself is actively maintained (Phoenix R&D / Cryspen) and had security fixes in 0.7.2 and 0.8.0 in February 2026. The npm package `openmls-wasm` is a single 0.1.0 publish from October 2025. It does not contain those fixes. Building a current WASM artifact would add a Rust toolchain this repo does not have, and the JS bindings are still incomplete. That path is the wrong dependency for a prototype we can test in Vitest.

### Why not sender keys

Signal-style sender keys would reuse the existing pairwise Double Ratchet as the distribution channel, and a hash chain plus an AES-GCM message key would encrypt one ciphertext per group message. Removal works only if every remaining sender deletes the old chain and distributes a new one. That is easy to get wrong:

- A member who skips rotation, or a server that redelivers an old distribution, leaves the removed member able to read that sender.
- Compromise of a sender chain exposes every later message from that sender until the next rotation. There is no DH ratchet inside the group.
- There is no authenticated group transcript. Members can disagree about who was in the group for a given message.
- Adding a member hands them the current chain, which is acceptable for future messages only if old message keys were deleted. It does not give the post-compromise behavior of an MLS Update path.

For eight people those operational bugs matter more than the cost of an MLS commit. MLS advances one epoch secret for the whole group. A removed leaf cannot derive the next epoch, even if they keep every previous key and ignore the removal commit. `ts-mls` records that explicitly: a member removed by a commit is absent from the update-path resolution and cannot derive the next epoch secrets.

Sender keys remain a reasonable fallback if we later have to drop `ts-mls`. They are not the prototype.

### What we reuse from 1:1

- The device Ed25519 signing key from `frontend/lib/crypto/keys.ts` (the same key `identity.ts` registers). Each device signs its MLS key package with that key. The API checks the signature against `Device.signingPublicKey` before it stores a key package. Other devices repeat the check before they accept an Add.
- The MLS credential is `sophia-mls/v1:<userId>:<deviceId>:admin|member`. An Update that swaps the user, device, or role is rejected. Adds of a key package we have not verified are rejected. Membership commits are accepted only from an admin leaf.
- Cipher suite 1 is the same algorithm family as 1:1: X25519, HKDF-SHA-256, AES-GCM, Ed25519.
- The server already stores opaque `Bytes` ciphertext for direct messages. Group blobs use the same rule.
- `ConversationType.GROUP` and conversation membership are the ACL. Direct chats are unchanged.

The 1:1 Double Ratchet is not the group message path. Group application messages are MLS private messages. Direct messages still use X3DH and the ratchet.

## Wire protocol

Each device is its own MLS leaf. Two devices of one user are two leaves and one ACL member.

1. `createGroupDevice` builds an MLS key package and an Ed25519 binding over those bytes.
2. `createGroupSession` opens an epoch-0 group that contains only the creator.
3. `addDevice` verifies the binding, checks the 8-user / 2-device cap, and commits an Add. The Welcome includes the ratchet tree extension, so the joiner does not need a side-channel tree.
4. Existing members call `trustKeyPackage` (same binding check) and then `applyCommit`. A commit that adds an unbound package is rejected and does not move their epoch.
5. The new device calls `joinFromWelcome` and must see exactly the expected member list.
6. `sealMessage` / `openMessage` encrypt one ciphertext for the current epoch. Every device that has processed the same commits can open it.
7. `removeDevice` commits a Remove and is refused for a non-admin. `proposeSelfRemoval` lets a member publish a Remove of their own leaf; `commitPending` is how an admin rotates the epoch afterward. The removed device, if it processes the commit, lands in `removedFromGroup`. If it ignores the commit and keeps the old epoch, it still cannot open the next application message.

Recommended server order for a membership change:

1. Add the user to the ACL (`POST /conversations/:id/members`) so they can upload a key package.
2. Upload the key package, the commit, and the Welcome.
3. On removal, upload the commit while the member can still fetch it, then `DELETE` the ACL row.

The ACL is not the cryptographic membership. A user who is in the database but has no Welcome cannot decrypt. A user who was removed from the database cannot fetch later blobs; even with a copy of those blobs they cannot decrypt, which is what the tests check.

## Feature flag

Both switches default to off.

| Variable | Where | Effect |
| --- | --- | --- |
| `GROUP_E2EE_ENABLED` | API | `503 group_e2ee_disabled` on `/conversations/group`, member changes, and `/conversations/:id/mls` |
| `NEXT_PUBLIC_GROUP_E2EE_ENABLED` | Web client | `api.createGroup` and the other group helpers throw before any request |

`GET /health` reports `groupE2ee` so an operator can see the API switch. The client flag is a product switch on a machine the user already controls. The API flag is what keeps group delivery off in production.

Pairwise `POST /conversations/:id/messages` and `GET /conversations/:id/messages` return 409 for a GROUP conversation, so a group is not silently downgraded to per-device Double Ratchet envelopes.

## Threat model

### Assets

- Message plaintext, including anything a leadership group would not want on the server.
- MLS private keys, leaf secrets, and epoch secrets. These stay in client memory.
- The device Ed25519 signing key, already the 1:1 identity key.

### Out of scope, same as 1:1

A malicious or modified frontend, a compromised browser, or a stolen unlocked device can read that device's messages and sign new key packages. MLS does not fix endpoint compromise. The account archive and cloud Sophia are separate and are not fed group plaintext by this prototype.

### Server

The API is an untrusted delivery service for group content.

| It learns | It does not learn |
| --- | --- |
| User ids in the ACL, device ids, blob kind, sizes, timestamps | Message plaintext |
| That a Welcome is addressed to a device | Welcome secrets (HPKE to the joiner's init key) |
| The public bytes of a key package, which are public by design | MLS private keys or epoch secrets |
| MLS private-message framing. The bytes include a public group id and epoch if someone parses them. This server does not parse them. | The sender's identity inside a private message, or the proposal list inside a private commit |

A malicious server can drop, delay, reorder, or fork commits. Clients process blobs in `(createdAt, id)` order and will fail closed on a gap, but this prototype has no MLS Delivery Service, no fork-resolution protocol, and no external commit policy. Two honest members can be split if the server shows them different commit histories. That is the main remaining availability and consistency gap.

The server ACL is enforced in addition to MLS, not instead of it. Removing a member deletes their `ConversationMember` row, and later GETs are 404. That stops casual delivery. It is not the cryptographic guarantee. The tests that matter decrypt with the removed member's old MLS state and expect failure.

### Members

- The creator is the admin. Honest clients accept an Add or a Remove only when the committer's leaf credential is `admin`. A modified client can still upload a commit; other members reject it and stay on the previous epoch. The server stores that blob but does not parse it, so it cannot delete the fork.
- A member leaves by publishing a Remove proposal for their own leaf. ts-mls rejects a commit that removes the committer, so an admin's client commits that proposal and rotates the epoch. Until that commit, the member can still read the group. The last admin cannot leave while anyone else remains. Promoting a second admin is not implemented.
- A removed member can still decrypt history from epochs they belonged to. Removal is forward. It is not a remote wipe.
- A new member cannot decrypt messages from before their Welcome. The client test checks that.
- `ts-mls` 1.6.4's `AuthenticationService` only sees one credential at a time. Successor continuity is enforced in our commit callback (an Update must keep the same `userId` and `deviceId`), not by the library.
- The binding signature is outside the MLS Add. Members accept an Add only after they have verified that same key package against the device signing key. A malicious member cannot sneak in an unbound package through `applyCommit`.
- Compromising a member who is still in the group exposes later messages until they are removed and the commit is applied. An automatic Update schedule (post-compromise self-healing while the member is still inside) is not implemented.
- Key package lifetime uses the library default (not before 0, not after `2^63-1`). We do not rotate key packages on a clock.

### Devices

Each device has its own leaf, its own MLS signature key, and the existing Sophia Ed25519 key. Removing one device does not remove the user's other device. The multi-device test seals one ciphertext, opens it on both of Alice's devices, then removes the laptop and checks that the laptop cannot open the next message while the phone and Bob can.

The sending device does not decrypt its own ciphertext. MLS consumes that generation on send. The sender keeps the plaintext locally. Other devices of the same user decrypt the group ciphertext.

### `ts-mls` itself

`ts-mls` has not had a formal security audit. The project says so. We use it because it is a maintained TypeScript implementation of RFC 9420 with tests of its own, not because it is a certified MLS stack. Treat this prototype as unaudited cryptography.

Our wrapper clones MLS state before `createCommit`, `createApplicationMessage`, and `processMessage`. ts-mls mutates epoch material while it works. A rejected commit must not destroy the caller's previous epoch. That clone is a safety rail around the library, not a claim that we reimplemented MLS.

## Persistence

`frontend/lib/crypto/group-store.ts` encodes the MLS group state with `encodeGroupState` and seals it with the same password-derived AES-GCM vault key used for the identity vault and encrypted device-recovery records. The additional data is `private-messenger/group-mls/v1:<userId>:<conversationId>`, so the ciphertext does not open for another account or another group. IndexedDB stores only the nonce and ciphertext (`groupSessions`). A refresh restores the epoch, including a sender's own unsent plaintext, which stays inside that sealed record until the upload succeeds.

Decrypted group messages are then cached in the same local message store as 1:1 plaintext. That cache is not separately encrypted. Locking the device drops the vault key, which is what makes the MLS secrets unreadable.

## Inbox

With both flags on, the inbox can create a group by name and username, open it, show members and roles, send and receive, add or remove members as an admin, and leave. The group screen does not offer Sophia, attachments, or calls. A GROUP conversation opened while the client flag is off does not fall through to the pairwise composer.

The creator's client builds the MLS group. Other members upload a key package when they open the thread. The admin's client commits the Add and Welcome on its next sync. Delivery while a thread is open polls every few seconds and also wakes on the existing `group_mls` websocket event, which carries only the conversation id.

## Admin and leaving

Server ACL: `ConversationMember.role` is `ADMIN` for the creator and `MEMBER` for everyone else. Only an admin can add a member or remove someone else. Any member can delete their own row, except the last admin while other members remain. That ACL is delivery control. The cryptographic rule is the credential role `sophia-mls/v1:<userId>:<deviceId>:admin|member`.

Self-leave uploads a Remove proposal. The admin client commits it, which changes the epoch key. The leaving client applies that commit, then deletes its ACL row. If no admin is online, the proposal waits and the member can still decrypt.

## What is not done

- No second admin. The creator stays the only admin, and cannot leave while the group still has other members.
- Leave does not finish until an admin client syncs and commits. There is no server-side commit.
- The inbox welcomes up to two active devices per member, but there is no device picker. A removed device still depends on the same commit path as a removed user.
- No scheduled Updates, external join, or PSK resumption.
- No group attachments, voice notes, archive history, or Sophia context. Do not send group plaintext to Cloud Sophia.
- No Delivery Service guarantees and no server-side MLS parsing. An uploaded commit is not checked against the ACL. Honest clients reject a non-admin membership commit; a malicious server can still fork what it delivers.
- The local decrypted-message cache is plaintext in IndexedDB, matching 1:1 messages. MLS private keys are not.
- Cap is 8 users and 2 devices each. That is a product limit in the client and the ACL, not an MLS limit.
- `ts-mls` 1.6.4 only. Do not bump it casually. It is unaudited.

## Tests

- `frontend/lib/crypto/group-mls.test.ts`: create, send/receive, add (including "untrusted Add is rejected" and "new member cannot read history"), remove (removed member cannot decrypt the next message, another member can), multi-device, binding-signature rejection, private keys absent from the published key package, admin-only removal, and self-leave (the removed member cannot decrypt the next message).
- `frontend/lib/crypto/group-store.test.ts`: sealed state round-trips across a restart, the ciphertext does not contain the leaf private key or message plaintext, and a wrong vault key or a different user or conversation cannot open it.
- `frontend/lib/group-runtime.test.ts`: create, deliver, restore from the sealed record, and complete self-leave when the admin syncs.
- `backend/tests/group-e2ee.test.ts`: flag off, 8-member cap, admin add/remove, member self-leave, last-admin refusal, removed member cannot be authorized for the next blob, schema rejects a `plaintext` field, stored bytes are the ciphertext, Welcome is device-addressed, Web Crypto Ed25519 signatures verify with the API's raw-key check.

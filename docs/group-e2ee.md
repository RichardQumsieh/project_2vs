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
- The MLS credential is `sophia-mls/v1:<userId>:<deviceId>:admin|member`. An Update that swaps the user or device is rejected. An Update that changes only `admin|member` is accepted as a proposal, and as a commit only when a different admin commits it. Adds of a key package we have not verified are rejected. Membership commits are accepted only from an admin leaf, except a commit whose only membership change is one or more self-removals.
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
7. `removeDevice` commits a Remove and is refused for a non-admin. `proposeSelfRemoval` lets a member publish a Remove of their own leaf. Any remaining member may `commitPending({ selfRemovalsOnly: true })`, which keeps only those self-removals. An admin's `commitPending` also commits Adds, admin Removes, and role Updates that match the directory. The removed device, if it processes the commit, lands in `removedFromGroup`. If it ignores the commit and keeps the old epoch, it still cannot open the next application message.
8. A role change is not an admin-signed Update of someone else's leaf. The target device calls `proposeRoleUpdate`, which signs a new leaf (new HPKE key, same Ed25519 signature key, same user and device, new `admin|member`). A different admin commits it. The proposer installs the new HPKE private key before applying that commit, because the update path is encrypted to the new key. ts-mls rejects a commit that contains the committer's own Update.

Recommended server order for a membership change:

1. Add the user to the ACL (`POST /conversations/:id/members`) so they can upload a key package.
2. Upload the key package, the commit, and the Welcome.
3. On removal, upload the commit while the member can still fetch it, then `DELETE` the ACL row.

The ACL is not the cryptographic membership. A user who is in the database but has no Welcome cannot decrypt. A user who was removed from the database cannot fetch later blobs; even with a copy of those blobs they cannot decrypt, which is what the tests check.

## Feature flag

Both switches default to off.

| Variable | Where | Effect |
| --- | --- | --- |
| `GROUP_E2EE_ENABLED` | API | `503 group_e2ee_disabled` on `/conversations/group`, member and role changes, the group read cursor, and `/conversations/:id/mls` |
| `NEXT_PUBLIC_GROUP_E2EE_ENABLED` | Web client | `api.createGroup` and the other group helpers throw before any request |

`GET /health` reports `groupE2ee` so an operator can see the API switch. The client flag is a product switch on a machine the user already controls. The API flag is what keeps group delivery off in production.

Pairwise `POST /conversations/:id/messages` and `GET /conversations/:id/messages` return 409 for a GROUP conversation, so a group is not silently downgraded to per-device Double Ratchet envelopes.

Apply `Conversation.mlsEpoch`, `GroupMlsCommit`, and `ConversationMember.groupReadBlobId` with the same `prisma db push` this prototype already uses. There is no migration directory. Those columns are delivery metadata, not message contents.

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
| The public MLS header of a private message: group id, epoch, and content type (`application`, `proposal`, or `commit`). Welcome and key-package messages are checked as structures only. | Message plaintext, proposal bodies, and the sender identity inside a private message. Public MLS messages are rejected so those bodies are not walked. |

`admitGroupBlob` rejects a truncated or trailing buffer (`400 mls_malformed`), an epoch other than the conversation's current epoch (`409 mls_epoch_order`), and a second commit for the epoch that already has one (`409 mls_epoch_conflict`). A stored commit advances `Conversation.mlsEpoch` by one. The upload transaction locks the conversation row first, so a slower application or proposal cannot write the epoch backwards after a commit, and two commits cannot both advance it. The same `clientId` may be retried; a different commit for that epoch may not. The check compares lengths and integer fields. It does not decode ciphertext.

A malicious server can still drop or delay blobs, and a commit that honest clients reject can still win the epoch. The server cannot see, inside the ciphertext, whether the committer is an admin. That commit then occupies the epoch and later honest commits are `mls_epoch_order` until someone recovers the group by hand. Two honest members who commit the same epoch are not forked in the database: the first insert wins, the other gets `409`, restores the session from before that commit, ingests the winner, and retries. There is still no MLS Delivery Service and no external-commit authentication.

The server ACL is enforced in addition to MLS, not instead of it. Removing a member deletes their `ConversationMember` row, and later GETs are 404. That stops casual delivery. It is not the cryptographic guarantee. The tests that matter decrypt with the removed member's old MLS state and expect failure.

### Members

- Honest clients accept an Add, a non-self Remove, or a role-changing Update only when the committer's leaf credential is `admin`, and a role-changing Update only when a different admin commits it. A modified client can still upload a well-formed commit. The server will store the first commit for that epoch. Other members reject it and do not advance, which stalls the group on the server epoch. That is the cost of staying plaintext-blind.
- A member leaves by publishing a Remove proposal for their own leaf. ts-mls rejects a commit that removes the committer, so some other member's client commits that proposal and rotates the epoch. The committer does not have to be an admin, and the commit includes only self-removals. Until that commit, the member can still read the group. Leave still needs one remaining member online. The sole remaining member deletes the ACL row and does not wait for a commit. The last admin cannot leave, and cannot be demoted, while anyone else remains.
- A second admin is an ACL change first (`PATCH` the member to `ADMIN`). The cryptographic role changes only after that member's device proposes an Update and another admin commits it. Until then, honest clients do not treat the promoted member as an MLS admin, and a demoted admin's old leaf can still produce commits those clients accept. The directory role has to match the proposed role or the admin's commit drops the proposal.
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

With both flags on, the inbox can create a group by name and username, open it, show members and roles, send and receive, add or remove members, promote or demote admins, attach a file, and leave. Admin buttons are shown only when the ACL role and the MLS leaf role are both admin. Those strings come from the same English and Arabic catalog as the rest of the app, and the group screen follows the document direction (titles and message text use bidirectional isolation; usernames and file names stay left-to-right). The group screen does not offer Sophia or calls. A GROUP conversation opened while the client flag is off does not fall through to the pairwise composer.

A group file uses the same client path as a 1:1 file: `inspectAndEncryptFileAttachment` (AES-GCM file key), upload of the ciphertext through the existing media route, and a `PM1FIL:` payload sealed inside an MLS application message. The file key and nonce travel inside MLS. The media bytes are the ciphertext. The group composer accepts the same document types as 1:1 (pdf, docx, pptx, xlsx, txt, csv). Upload still requires the same object-storage configuration as a 1:1 attachment.

The conversation list shows an unread count for groups. It counts application blobs after `ConversationMember.groupReadBlobId`, excluding the viewer's own sends. Opening the thread moves that cursor. The count is metadata (kind, sender user, time, id). Payloads are not loaded for it.

The creator's client builds the MLS group. Other members upload a key package when they open the thread. The admin's client commits the Add and Welcome on its next sync. Delivery while a thread is open polls every few seconds and also wakes on the `group_mls` websocket event. That event carries the conversation id and the blob kind. It does not carry plaintext. A notification is raised only for an application blob, only when that thread is not the visible open conversation, and the title and body are catalog strings that name the group. They do not include the message.

## Admin and leaving

Server ACL: `ConversationMember.role` starts as `ADMIN` for the creator and `MEMBER` for everyone else. An admin can add a member, remove someone else, or `PATCH` another member's role. Any member can delete their own row, except the last admin while other members remain. Demoting the last admin is the same `409 last_admin`. That ACL is delivery control. The cryptographic rule is the credential role `sophia-mls/v1:<userId>:<deviceId>:admin|member`.

Self-leave uploads a Remove proposal. The next member whose client syncs commits that proposal (and only self-removals, if that client is not an MLS admin) and rotates the epoch key. The leaving client applies that commit, then deletes its ACL row. If nobody else is online, the proposal waits and the member can still decrypt. There is no server-side commit. If they are the only member left, the client deletes the ACL row immediately.

Promote and demote update the ACL immediately and show a notice that the MLS role finishes when that member's device is online and another admin commits the Update.

## What is not done

- The server does not authenticate that a committer is an admin. A well-formed commit that honest clients reject can occupy the epoch and stall the group. Recovery from that stall is not automatic.
- Leave finishes when any other member's client syncs. It does not finish while every other member is offline, and the server does not commit on their behalf. The last admin still cannot leave or be demoted while other members remain.
- A demotion or promotion is not cryptographic until the Update commit. Until then the old leaf role is what honest clients enforce.
- The inbox welcomes up to two active devices per member, but there is no device picker. A removed device still depends on the same commit path as a removed user.
- No scheduled Updates, external join, or PSK resumption.
- No group voice notes, photos, albums, archive history, or Sophia context. Do not send group plaintext to Cloud Sophia. File attachments need the same media storage configuration as 1:1.
- Notifications name the group only. They require browser notification permission and include no message preview.
- No full MLS Delivery Service. Epoch order and one-commit-per-epoch are enforced from the public header. A malicious server that ignores its own checks can still fork what it delivers.
- The local decrypted-message cache is plaintext in IndexedDB, matching 1:1 messages. MLS private keys, including a pending role-update HPKE key, stay inside the sealed group record.
- Cap is 8 users and 2 devices each. That is a product limit in the client and the ACL, not an MLS limit.
- `ts-mls` 1.6.4 only. Do not bump it casually. It is unaudited.

## Tests

- `frontend/lib/crypto/group-mls.test.ts`: create, send/receive, add (including "untrusted Add is rejected" and "new member cannot read history"), remove (removed member cannot decrypt the next message, another member can), multi-device, binding-signature rejection, private keys absent from the published key package, admin-only removal, self-leave (the removed member cannot decrypt the next message), promote and demote (the new HPKE key is installed before the Update commit, and a demoted leaf cannot remove another member), a non-admin committing only a self-removal, and a file attachment whose MLS ciphertext does not contain the file key or the file bytes.
- `frontend/lib/crypto/group-store.test.ts`: sealed state round-trips across a restart, the ciphertext does not contain the leaf private key or message plaintext, and a wrong vault key or a different user or conversation cannot open it.
- `frontend/lib/group-runtime.test.ts`: create, deliver, restore from the sealed record, complete self-leave when the admin syncs, complete self-leave when a non-admin commits and the admin does not sync, and recover when two admins commit the same epoch (the loser rolls back, ingests the winner, and can still read the next message).
- `frontend/lib/group-alerts.test.ts`: a notification is considered only for an application blob, and not while that group is the visible open thread.
- `backend/tests/group-e2ee.test.ts`: flag off, 8-member cap, admin add/remove, member self-leave, last-admin refusal on leave and on demote, a second admin can leave, removed member cannot be authorized for the next blob, schema rejects a `plaintext` field, stored bytes are the ciphertext, Welcome is device-addressed, Web Crypto Ed25519 signatures verify with the API's raw-key check, malformed and out-of-order and forked commits are rejected from the public header, and unread counts skip the viewer's own application blobs and anything at or before the read cursor.

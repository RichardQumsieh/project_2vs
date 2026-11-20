import { describe, expect, it } from "vitest";
import { deriveVaultKey } from "./kdf";
import { generateEd25519 } from "./keys";
import {
  addDevice,
  createGroupDevice,
  createGroupSession,
  joinFromWelcome,
  openMessage,
  publishedKeyPackage,
  sealMessage,
} from "./group-mls";
import { b64ToBytes } from "./bytes";
import { openGroupRecord, sealGroupRecord, type GroupRecord } from "./group-store";

const aliceUser = "11111111-1111-4111-8111-111111111111";
const alicePhone = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const bobUser = "22222222-2222-4222-8222-222222222222";
const bobPhone = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const groupId = "44444444-4444-4444-8444-444444444444";
const SECRET = "vault-sealed epoch secret 91ac";

describe("encrypted MLS group state", { timeout: 30_000 }, () => {
  it("round-trips a group across a restart and refuses the wrong vault key", async () => {
    const aliceKeys = await generateEd25519();
    const bobKeys = await generateEd25519();
    const aliceDevice = await createGroupDevice({
      userId: aliceUser,
      deviceId: alicePhone,
      role: "admin",
      sophiaSigningPrivateJwk: aliceKeys.privateJwk,
      sophiaSigningPublicKey: aliceKeys.publicKey,
    });
    const bobDevice = await createGroupDevice({
      userId: bobUser,
      deviceId: bobPhone,
      role: "member",
      sophiaSigningPrivateJwk: bobKeys.privateJwk,
      sophiaSigningPublicKey: bobKeys.publicKey,
    });
    let alice = await createGroupSession(aliceDevice, groupId);
    const added = await addDevice(alice, publishedKeyPackage(bobDevice), bobDevice.sophiaSigningPublicKey);
    alice = added.session;
    const bob = await joinFromWelcome(bobDevice, added.welcome);
    const sealedMessage = await sealMessage(bob, SECRET);

    const record: GroupRecord = {
      device: aliceDevice,
      session: alice,
      appliedBlobIds: ["blob-1"],
      keyPackages: [publishedKeyPackage(bobDevice)],
      outbox: [{
        clientId: "11111111-1111-4111-8111-111111111112",
        kind: "application",
        payload: sealedMessage.message,
        plaintext: SECRET,
      }],
    };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveVaultKey("leadership-passphrase", salt);
    const other = await deriveVaultKey("other-passphrase", salt);
    const sealed = await sealGroupRecord(key, aliceUser, groupId, record);
    const stored = b64ToBytes(sealed.ciphertext);
    expect(contains(stored, alice.state.signaturePrivateKey)).toBe(false);
    expect(contains(stored, new TextEncoder().encode(SECRET))).toBe(false);

    const opened = await openGroupRecord(key, aliceUser, groupId, sealed);
    expect(opened.appliedBlobIds).toEqual(["blob-1"]);
    expect(opened.outbox[0]?.plaintext).toBe(SECRET);
    expect(opened.session).not.toBeNull();
    const read = await openMessage(opened.session!, sealedMessage.message);
    expect(read.plaintext).toBe(SECRET);

    await expect(openGroupRecord(other, aliceUser, groupId, sealed)).rejects.toMatchObject({
      code: "cannot_decrypt",
    });
    await expect(openGroupRecord(key, bobUser, groupId, sealed)).rejects.toMatchObject({
      code: "cannot_decrypt",
    });
    await expect(openGroupRecord(key, aliceUser, bobPhone, sealed)).rejects.toMatchObject({
      code: "cannot_decrypt",
    });
  });
});

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    let matched = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[offset + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

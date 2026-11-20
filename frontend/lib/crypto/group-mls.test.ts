import { describe, expect, it } from "vitest";
import { generateEd25519 } from "./keys";
import {
  addDevice,
  applyCommit,
  applyProposal,
  assertMembershipCapacity,
  commitPending,
  createGroupDevice,
  createGroupSession,
  GROUP_E2EE_MAX_USERS,
  GroupCryptoError,
  groupEpoch,
  hasPendingProposals,
  joinFromWelcome,
  listMembers,
  listRoster,
  openMessage,
  proposeSelfRemoval,
  publishedKeyPackage,
  removeDevice,
  sealMessage,
  trustKeyPackage,
  wireContainsPlaintext,
  type DeviceRef,
  type GroupDevice,
  type GroupRole,
} from "./group-mls";

const aliceUser = "11111111-1111-4111-8111-111111111111";
const alicePhone = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const aliceLaptop = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const bobUser = "22222222-2222-4222-8222-222222222222";
const bobPhone = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const carolUser = "33333333-3333-4333-8333-333333333333";
const carolPhone = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const groupId = "44444444-4444-4444-8444-444444444444";

const SECRET = "leadership-only: acquire northwind 9f3c1a7e";
const AFTER_REMOVAL = "after removal bob must not read 0c77ee91";

async function makeDevice(
  userId: string,
  deviceId: string,
  role: GroupRole = "member",
): Promise<GroupDevice> {
  const signing = await generateEd25519();
  return createGroupDevice({
    userId,
    deviceId,
    role,
    sophiaSigningPrivateJwk: signing.privateJwk,
    sophiaSigningPublicKey: signing.publicKey,
  });
}

function refs(...devices: GroupDevice[]): DeviceRef[] {
  return devices.map((device) => device.ref);
}

async function startPair(group: string) {
  const alice = await makeDevice(aliceUser, alicePhone, "admin");
  const bob = await makeDevice(bobUser, bobPhone);
  let aliceSession = await createGroupSession(alice, group);
  const added = await addDevice(aliceSession, publishedKeyPackage(bob), bob.sophiaSigningPublicKey);
  aliceSession = added.session;
  const bobSession = await joinFromWelcome(bob, added.welcome, refs(alice, bob));
  return { alice, bob, aliceSession, bobSession };
}

describe("MLS small groups", { timeout: 30_000 }, () => {
  it("creates a group and delivers one ciphertext to the other member", async () => {
    const { aliceSession, bobSession } = await startPair(groupId);
    expect(groupEpoch(aliceSession)).toBe(groupEpoch(bobSession));
    expect(listMembers(aliceSession).map((member) => member.userId).sort()).toEqual([
      aliceUser,
      bobUser,
    ]);

    const sealed = await sealMessage(aliceSession, SECRET);
    expect(wireContainsPlaintext(sealed.message, SECRET)).toBe(false);

    const opened = await openMessage(bobSession, sealed.message);
    expect(opened.plaintext).toBe(SECRET);
  });

  it("lets a newly added member read later messages and not earlier ones", async () => {
    const pair = await startPair("55555555-5555-4555-8555-555555555555");
    const before = await sealMessage(pair.aliceSession, "before carol joins");
    const bobRead = await openMessage(pair.bobSession, before.message);

    const carol = await makeDevice(carolUser, carolPhone);
    const published = publishedKeyPackage(carol);
    const added = await addDevice(before.session, published, carol.sophiaSigningPublicKey);
    await expect(applyCommit(bobRead.session, added.commit)).rejects.toMatchObject({
      code: "rejected",
    });

    const bobTrusted = await trustKeyPackage(
      bobRead.session,
      published,
      carol.sophiaSigningPublicKey,
    );
    const bobNext = await applyCommit(bobTrusted, added.commit);
    expect(bobNext.selfRemoved).toBe(false);
    const carolSession = await joinFromWelcome(carol, added.welcome, refs(pair.alice, pair.bob, carol));

    await expect(openMessage(carolSession, before.message)).rejects.toMatchObject({
      code: "cannot_decrypt",
    });

    const after = await sealMessage(added.session, "carol can read this");
    const carolOpened = await openMessage(carolSession, after.message);
    const bobOpened = await openMessage(bobNext.session, after.message);
    expect(carolOpened.plaintext).toBe("carol can read this");
    expect(bobOpened.plaintext).toBe("carol can read this");
  });

  it("rotates the epoch so a removed member cannot decrypt subsequent messages", async () => {
    const pair = await startPair("66666666-6666-4666-8666-666666666666");
    const carol = await makeDevice(carolUser, carolPhone);
    const carolPublished = publishedKeyPackage(carol);
    const added = await addDevice(
      pair.aliceSession,
      carolPublished,
      carol.sophiaSigningPublicKey,
    );
    const bobWithCarol = await applyCommit(
      await trustKeyPackage(pair.bobSession, carolPublished, carol.sophiaSigningPublicKey),
      added.commit,
    );
    const carolSession = await joinFromWelcome(
      carol,
      added.welcome,
      refs(pair.alice, pair.bob, carol),
    );

    const first = await sealMessage(added.session, "while bob is a member");
    const bobHadAccess = await openMessage(bobWithCarol.session, first.message);
    expect(bobHadAccess.plaintext).toBe("while bob is a member");

    const removed = await removeDevice(first.session, bobPhone);
    expect(listMembers(removed.session).map((member) => member.userId).sort()).toEqual([
      aliceUser,
      carolUser,
    ]);
    expect(groupEpoch(removed.session)).toBe(groupEpoch(added.session) + 1);

    const bobLearns = await applyCommit(bobHadAccess.session, removed.commit);
    expect(bobLearns.selfRemoved).toBe(true);
    const carolStays = await applyCommit(carolSession, removed.commit);
    expect(carolStays.selfRemoved).toBe(false);

    const later = await sealMessage(removed.session, AFTER_REMOVAL);
    expect(wireContainsPlaintext(later.message, AFTER_REMOVAL)).toBe(false);
    expect((await openMessage(carolStays.session, later.message)).plaintext).toBe(AFTER_REMOVAL);

    await expect(openMessage(bobHadAccess.session, later.message)).rejects.toMatchObject({
      code: "cannot_decrypt",
    });
    await expect(openMessage(bobLearns.session, later.message)).rejects.toMatchObject({
      code: "not_member",
    });
  });

  it("decrypts one group ciphertext on every device of a member, and drops a removed device", async () => {
    const phone = await makeDevice(aliceUser, alicePhone, "admin");
    const laptop = await makeDevice(aliceUser, aliceLaptop, "admin");
    const bob = await makeDevice(bobUser, bobPhone);
    let phoneSession = await createGroupSession(phone, "77777777-7777-4777-8777-777777777777");

    const addLaptop = await addDevice(
      phoneSession,
      publishedKeyPackage(laptop),
      laptop.sophiaSigningPublicKey,
    );
    phoneSession = addLaptop.session;
    const laptopSession = await joinFromWelcome(laptop, addLaptop.welcome, refs(phone, laptop));

    const addBob = await addDevice(phoneSession, publishedKeyPackage(bob), bob.sophiaSigningPublicKey);
    phoneSession = addBob.session;
    const laptopAfterBob = await trustKeyPackage(
      laptopSession,
      publishedKeyPackage(bob),
      bob.sophiaSigningPublicKey,
    ).then((session) => applyCommit(session, addBob.commit));
    const bobSession = await joinFromWelcome(bob, addBob.welcome, refs(phone, laptop, bob));

    const sealed = await sealMessage(bobSession, "both of alice's devices");
    expect(wireContainsPlaintext(sealed.message, "both of alice's devices")).toBe(false);
    const onPhone = await openMessage(phoneSession, sealed.message);
    const onLaptop = await openMessage(laptopAfterBob.session, sealed.message);
    expect(onPhone.plaintext).toBe("both of alice's devices");
    expect(onLaptop.plaintext).toBe("both of alice's devices");

    const dropLaptop = await removeDevice(onPhone.session, aliceLaptop);
    const bobAfter = await applyCommit(sealed.session, dropLaptop.commit);
    expect(bobAfter.selfRemoved).toBe(false);
    const phoneAfter = dropLaptop.session;
    const next = await sealMessage(phoneAfter, "laptop was removed");
    expect((await openMessage(bobAfter.session, next.message)).plaintext).toBe("laptop was removed");
    await expect(openMessage(onLaptop.session, next.message)).rejects.toMatchObject({
      code: "cannot_decrypt",
    });
    const laptopRemoved = await applyCommit(onLaptop.session, dropLaptop.commit);
    expect(laptopRemoved.selfRemoved).toBe(true);
    await expect(openMessage(laptopRemoved.session, next.message)).rejects.toMatchObject({
      code: "not_member",
    });
  });

  it("refuses a key package signed by a different device", async () => {
    const alice = await makeDevice(aliceUser, alicePhone, "admin");
    const bob = await makeDevice(bobUser, bobPhone);
    const eve = await makeDevice(carolUser, carolPhone);
    const session = await createGroupSession(alice, "88888888-8888-4888-8888-888888888888");
    const forged = {
      ...publishedKeyPackage(eve),
      userId: bob.ref.userId,
      deviceId: bob.ref.deviceId,
    };
    await expect(
      addDevice(session, forged, bob.sophiaSigningPublicKey),
    ).rejects.toBeInstanceOf(GroupCryptoError);
    await expect(
      addDevice(session, publishedKeyPackage(bob), eve.sophiaSigningPublicKey),
    ).rejects.toBeInstanceOf(GroupCryptoError);
  });

  it("does not put MLS private keys in the published key package", async () => {
    const device = await makeDevice(aliceUser, alicePhone, "admin");
    const published = publishedKeyPackage(device);
    expect(Object.keys(published).sort()).toEqual([
      "bindingSignatureB64",
      "deviceId",
      "keyPackageB64",
      "userId",
    ]);
    const wire = Uint8Array.from(Buffer.from(published.keyPackageB64, "base64"));
    for (const secret of [
      device.privatePackage.initPrivateKey,
      device.privatePackage.hpkePrivateKey,
      device.privatePackage.signaturePrivateKey,
    ]) {
      expect(contains(wire, secret)).toBe(false);
    }
  });

  it("lets an admin commit a member's self-removal, and a member cannot remove someone else", async () => {
    const pair = await startPair("99999999-9999-4999-8999-999999999991");
    const carol = await makeDevice(carolUser, carolPhone);
    const added = await addDevice(pair.aliceSession, publishedKeyPackage(carol), carol.sophiaSigningPublicKey);
    const bobSession = await trustKeyPackage(
      pair.bobSession,
      publishedKeyPackage(carol),
      carol.sophiaSigningPublicKey,
    ).then((session) => applyCommit(session, added.commit));
    const carolSession = await joinFromWelcome(carol, added.welcome, refs(pair.alice, pair.bob, carol));

    await expect(removeDevice(bobSession.session, carolPhone)).rejects.toMatchObject({
      code: "rejected",
    });
    const forged = await removeDevice(bobSession.session, carolPhone, { enforceAdmin: false });
    const epochBeforeForgery = groupEpoch(added.session);
    await expect(applyCommit(added.session, forged.commit)).rejects.toMatchObject({ code: "rejected" });
    expect(groupEpoch(added.session)).toBe(epochBeforeForgery);

    const proposed = await proposeSelfRemoval(bobSession.session);
    expect(hasPendingProposals(proposed.session)).toBe(true);
    expect(listMembers(proposed.session).some((member) => member.deviceId === bobPhone)).toBe(true);
    const aliceSaw = await applyProposal(added.session, proposed.proposal);
    const carolSaw = await applyProposal(carolSession, proposed.proposal);
    const committed = await commitPending(aliceSaw);
    expect(groupEpoch(committed.session)).toBeGreaterThan(groupEpoch(aliceSaw));
    expect(listRoster(committed.session).some((leaf) => leaf.deviceId === bobPhone)).toBe(false);
    expect(listRoster(committed.session).every((leaf) => leaf.role === "admin" || leaf.deviceId === carolPhone)).toBe(true);

    const carolAfter = await applyCommit(carolSaw, committed.commit);
    const bobAfter = await applyCommit(proposed.session, committed.commit);
    expect(bobAfter.selfRemoved).toBe(true);
    const later = await sealMessage(committed.session, AFTER_REMOVAL);
    expect((await openMessage(carolAfter.session, later.message)).plaintext).toBe(AFTER_REMOVAL);
    await expect(openMessage(bobAfter.session, later.message)).rejects.toMatchObject({ code: "not_member" });
    await expect(openMessage(proposed.session, later.message)).rejects.toMatchObject({ code: "cannot_decrypt" });
  });

  it("caps the prototype at 8 users and 2 devices each", () => {
    const members = Array.from({ length: GROUP_E2EE_MAX_USERS }, (_, index) => ({
      userId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      deviceId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    }));
    expect(() =>
      assertMembershipCapacity(members, {
        userId: "99999999-9999-4999-8999-999999999999",
        deviceId: "99999999-9999-4999-8999-999999999998",
      }),
    ).toThrow(/8 members/);
    expect(() =>
      assertMembershipCapacity(
        [members[0]!, { ...members[0]!, deviceId: "12121212-1212-4121-8121-121212121212" }],
        { ...members[0]!, deviceId: "13131313-1313-4131-8131-131313131313" },
      ),
    ).toThrow(/2 devices/);
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

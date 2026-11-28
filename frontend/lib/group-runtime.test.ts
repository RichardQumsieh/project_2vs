import { describe, expect, it } from "vitest";
import { b64ToBytes } from "./crypto/bytes";
import { generateEd25519 } from "./crypto/keys";
import { openGroupRecord, sealGroupRecord, type GroupRecord } from "./crypto/group-store";
import { deriveVaultKey } from "./crypto/kdf";
import {
  ackGroupDeliveries,
  mlsHistoryCursor,
  queueGroupMessage,
  queueMemberRemoval,
  queueSelfRemoval,
  shouldReloadGroupBlobs,
  syncGroup,
  type DirectoryDevice,
  type GroupWireBlob,
} from "./group-runtime";
import type { GroupRole } from "./crypto/group-mls";

const aliceUser = "11111111-1111-4111-8111-111111111111";
const alicePhone = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const bobUser = "22222222-2222-4222-8222-222222222222";
const bobPhone = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const groupId = "44444444-4444-4444-8444-444444444449";
const SECRET = "runtime leadership note a17c";
const AFTER = "after bob left the room b20d";

describe("group runtime", { timeout: 30_000 }, () => {
  it("creates, delivers, survives a sealed restart, and completes self-leave", async () => {
    const aliceKeys = await generateEd25519();
    const bobKeys = await generateEd25519();
    const log: GroupWireBlob[] = [];
    let stamp = 0;
    const post = (senderDeviceId: string) => async (body: {
      clientId: string;
      kind: GroupWireBlob["kind"];
      payload: string;
      recipientDeviceId?: string;
      bindingSignature?: string;
    }) => {
      stamp += 1;
      const id = `00000000-0000-4000-8000-${String(stamp).padStart(12, "0")}`;
      log.push({
        id,
        kind: body.kind,
        senderDeviceId,
        recipientDeviceId: body.recipientDeviceId ?? null,
        payload: body.payload,
        bindingSignature: body.bindingSignature ?? null,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, stamp)).toISOString(),
      });
      return { id };
    };

    const directory = (records: Array<GroupRecord | null>): DirectoryDevice[] =>
      records.flatMap((record) => record
        ? [{
            userId: record.device.ref.userId,
            deviceId: record.device.ref.deviceId,
            signingPublicKey: record.device.sophiaSigningPublicKey,
            role: record.device.role,
          }]
        : []);

    let alice: GroupRecord | null = null;
    let bob: GroupRecord | null = null;
    const run = (who: "alice" | "bob", record: GroupRecord | null) => syncGroup({
      record,
      userId: who === "alice" ? aliceUser : bobUser,
      deviceId: who === "alice" ? alicePhone : bobPhone,
      role: who === "alice" ? "admin" : "member",
      conversationId: groupId,
      signingPrivateJwk: who === "alice" ? aliceKeys.privateJwk : bobKeys.privateJwk,
      signingPublicKey: who === "alice" ? aliceKeys.publicKey : bobKeys.publicKey,
      memberUserIds: [aliceUser, bobUser],
      directory: directory([alice, bob, record]),
      blobs: log,
      post: post(who === "alice" ? alicePhone : bobPhone),
    });

    alice = (await run("alice", alice)).record;
    bob = (await run("bob", bob)).record;
    alice = (await run("alice", alice)).record;
    const joined = await run("bob", bob);
    bob = joined.record;
    expect(joined.error).toBeNull();
    expect(bob.session).not.toBeNull();

    alice = await queueGroupMessage(alice, SECRET);
    alice = (await run("alice", alice)).record;
    const read = await run("bob", bob);
    bob = read.record;
    expect(read.messages.map((message) => message.plaintext)).toEqual([SECRET]);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveVaultKey("shared-device-password", salt);
    const sealedBob = await sealGroupRecord(key, bobUser, groupId, bob);
    bob = await openGroupRecord(key, bobUser, groupId, sealedBob);

    alice = await queueGroupMessage(alice, "still here after bob restarted");
    alice = (await run("alice", alice)).record;
    const afterRestart = await run("bob", bob);
    bob = afterRestart.record;
    expect(afterRestart.messages.map((message) => message.plaintext)).toEqual([
      "still here after bob restarted",
    ]);

    bob = await queueSelfRemoval(bob);
    bob = (await run("bob", bob)).record;
    alice = (await run("alice", alice)).record;
    const removed = await run("bob", bob);
    bob = removed.record;
    expect(removed.selfRemoved).toBe(true);

    alice = await queueGroupMessage(alice, AFTER);
    alice = (await run("alice", alice)).record;
    const denied = await run("bob", bob);
    expect(denied.selfRemoved).toBe(true);
    expect(denied.messages.map((message) => message.plaintext)).not.toContain(AFTER);
    expect(denied.error).toBeNull();
  });

  it("finishes a leave when a non-admin commits and the admin stays offline", async () => {
    const carolUser = "33333333-3333-4333-8333-333333333333";
    const carolPhone = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    const keys = {
      alice: await generateEd25519(),
      bob: await generateEd25519(),
      carol: await generateEd25519(),
    };
    const ids = {
      alice: { userId: aliceUser, deviceId: alicePhone },
      bob: { userId: bobUser, deviceId: bobPhone },
      carol: { userId: carolUser, deviceId: carolPhone },
    };
    const log: GroupWireBlob[] = [];
    let stamp = 0;
    const post = (senderDeviceId: string) => async (body: {
      clientId: string;
      kind: GroupWireBlob["kind"];
      payload: string;
      recipientDeviceId?: string;
      bindingSignature?: string;
    }) => {
      stamp += 1;
      const id = `00000000-0000-4000-8000-${String(stamp).padStart(12, "0")}`;
      log.push({
        id,
        kind: body.kind,
        senderDeviceId,
        recipientDeviceId: body.recipientDeviceId ?? null,
        payload: body.payload,
        bindingSignature: body.bindingSignature ?? null,
        createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, stamp)).toISOString(),
      });
      return { id };
    };
    let alice: GroupRecord | null = null;
    let bob: GroupRecord | null = null;
    let carol: GroupRecord | null = null;
    const roles: Record<string, GroupRole> = {
      [alicePhone]: "admin",
      [bobPhone]: "member",
      [carolPhone]: "member",
    };
    const run = async (who: "alice" | "bob" | "carol", record: GroupRecord | null) => {
      const current = { alice, bob, carol, [who]: record };
      const directory: DirectoryDevice[] = (["alice", "bob", "carol"] as const).flatMap((name) => {
        const stored = current[name];
        if (!stored) return [];
        return [{
          userId: ids[name].userId,
          deviceId: ids[name].deviceId,
          signingPublicKey: stored.device.sophiaSigningPublicKey,
          role: roles[ids[name].deviceId] ?? "member",
        }];
      });
      return syncGroup({
        record,
        userId: ids[who].userId,
        deviceId: ids[who].deviceId,
        role: roles[ids[who].deviceId] ?? "member",
        conversationId: "44444444-4444-4444-8444-444444444450",
        signingPrivateJwk: keys[who].privateJwk,
        signingPublicKey: keys[who].publicKey,
        memberUserIds: [aliceUser, bobUser, carolUser],
        directory,
        blobs: log,
        post: post(ids[who].deviceId),
      });
    };

    alice = (await run("alice", alice)).record;
    bob = (await run("bob", bob)).record;
    carol = (await run("carol", carol)).record;
    alice = (await run("alice", alice)).record;
    bob = (await run("bob", bob)).record;
    alice = (await run("alice", alice)).record;
    carol = (await run("carol", carol)).record;
    expect(carol?.session).not.toBeNull();

    bob = await queueSelfRemoval(bob!);
    bob = (await run("bob", bob)).record;
    carol = (await run("carol", carol)).record;
    const removed = await run("bob", bob);
    expect(removed.error).toBeNull();
    expect(removed.selfRemoved).toBe(true);

    carol = await queueGroupMessage(carol!, "after bob left without an admin");
    carol = (await run("carol", carol)).record;
    const denied = await run("bob", removed.record);
    expect(denied.messages.map((message) => message.plaintext)).not.toContain("after bob left without an admin");
    expect(denied.selfRemoved).toBe(true);
  });

  it("recovers when two admins commit the same epoch", async () => {
    const carolUser = "33333333-3333-4333-8333-333333333333";
    const carolPhone = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
    const daveUser = "55555555-5555-4555-8555-555555555556";
    const davePhone = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    const keys = {
      alice: await generateEd25519(),
      carol: await generateEd25519(),
      dave: await generateEd25519(),
    };
    const conversationId = "44444444-4444-4444-8444-444444444451";
    const log: GroupWireBlob[] = [];
    let stamp = 0;
    let fence = false;
    const committedEpochs = new Set<number>();
    const post = (senderDeviceId: string) => async (body: {
      clientId: string;
      kind: GroupWireBlob["kind"];
      payload: string;
      recipientDeviceId?: string;
      bindingSignature?: string;
    }) => {
      if (fence && body.kind === "commit") {
        const epoch = privateMessageEpoch(body.payload);
        if (epoch === null || committedEpochs.has(epoch)) {
          throw Object.assign(new Error("Another member already committed this epoch"), {
            code: "mls_epoch_conflict",
          });
        }
        committedEpochs.add(epoch);
      }
      stamp += 1;
      const id = `00000000-0000-4000-8000-${String(1000 + stamp).padStart(12, "0")}`;
      log.push({
        id,
        kind: body.kind,
        senderDeviceId,
        recipientDeviceId: body.recipientDeviceId ?? null,
        payload: body.payload,
        bindingSignature: body.bindingSignature ?? null,
        createdAt: new Date(Date.UTC(2026, 0, 3, 0, 0, stamp)).toISOString(),
      });
      return { id };
    };
    const roles: Record<string, GroupRole> = {
      [alicePhone]: "admin",
      [carolPhone]: "member",
      [davePhone]: "member",
    };
    let alice: GroupRecord | null = null;
    let carol: GroupRecord | null = null;
    let dave: GroupRecord | null = null;
    const people = {
      alice: { userId: aliceUser, deviceId: alicePhone, keys: keys.alice },
      carol: { userId: carolUser, deviceId: carolPhone, keys: keys.carol },
      dave: { userId: daveUser, deviceId: davePhone, keys: keys.dave },
    };
    const run = async (who: keyof typeof people, record: GroupRecord | null) => {
      const current = { alice, carol, dave, [who]: record };
      const directory: DirectoryDevice[] = (Object.keys(people) as Array<keyof typeof people>).flatMap((name) => {
        const stored = current[name];
        if (!stored) return [];
        return [{
          userId: people[name].userId,
          deviceId: people[name].deviceId,
          signingPublicKey: stored.device.sophiaSigningPublicKey,
          role: roles[people[name].deviceId] ?? "member",
        }];
      });
      return syncGroup({
        record,
        userId: people[who].userId,
        deviceId: people[who].deviceId,
        role: record === null && who === "alice" ? "admin" : "member",
        conversationId,
        signingPrivateJwk: people[who].keys.privateJwk,
        signingPublicKey: people[who].keys.publicKey,
        memberUserIds: [aliceUser, carolUser, daveUser],
        directory,
        blobs: log,
        post: post(people[who].deviceId),
      });
    };

    alice = (await run("alice", null)).record;
    carol = (await run("carol", null)).record;
    dave = (await run("dave", null)).record;
    alice = (await run("alice", alice)).record;
    carol = (await run("carol", carol)).record;
    alice = (await run("alice", alice)).record;
    dave = (await run("dave", dave)).record;
    expect(dave?.session).not.toBeNull();
    expect(carol?.session).not.toBeNull();

    roles[carolPhone] = "admin";
    carol = (await run("carol", carol)).record;
    alice = (await run("alice", alice)).record;
    carol = (await run("carol", carol)).record;
    expect(carol?.device.role).toBe("admin");

    fence = true;
    alice = await queueMemberRemoval(alice!, davePhone);
    carol = await queueMemberRemoval(carol!, davePhone);
    alice = (await run("alice", alice)).record;
    const recovered = await run("carol", carol);
    expect(recovered.error).toBeNull();
    carol = recovered.record;
    alice = await queueGroupMessage(alice!, "the fork resolved on one epoch");
    alice = (await run("alice", alice)).record;
    const read = await run("carol", carol);
    expect(read.error).toBeNull();
    expect(read.messages.map((message) => message.plaintext)).toContain("the fork resolved on one epoch");
  });

  it("reseals a queued application after ingesting a newer epoch", async () => {
    const keys = {
      alice: await generateEd25519(),
      bob: await generateEd25519(),
      carol: await generateEd25519(),
    };
    const carolUser = "33333333-3333-4333-8333-333333333334";
    const carolPhone = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
    const log: GroupWireBlob[] = [];
    let stamp = 0;
    let serverEpoch = 0;
    const post = (senderDeviceId: string) => async (body: {
      clientId: string;
      kind: GroupWireBlob["kind"];
      payload: string;
      recipientDeviceId?: string;
      bindingSignature?: string;
    }) => {
      if (body.kind === "commit" || body.kind === "application" || body.kind === "proposal") {
        const epoch = privateMessageEpoch(body.payload);
        if (epoch === null || epoch !== serverEpoch) {
          throw Object.assign(new Error("MLS epoch is not the current group epoch"), {
            code: "mls_epoch_order",
          });
        }
        if (body.kind === "commit") serverEpoch += 1;
      }
      stamp += 1;
      const id = `00000000-0000-4000-8000-${String(3000 + stamp).padStart(12, "0")}`;
      log.push({
        id,
        kind: body.kind,
        senderDeviceId,
        recipientDeviceId: body.recipientDeviceId ?? null,
        payload: body.payload,
        bindingSignature: body.bindingSignature ?? null,
        createdAt: new Date(Date.UTC(2026, 0, 5, 0, 0, stamp)).toISOString(),
      });
      return { id };
    };
    let alice: GroupRecord | null = null;
    let bob: GroupRecord | null = null;
    let carol: GroupRecord | null = null;
    const people = {
      alice: { userId: aliceUser, deviceId: alicePhone, keys: keys.alice, role: "admin" as GroupRole },
      bob: { userId: bobUser, deviceId: bobPhone, keys: keys.bob, role: "member" as GroupRole },
      carol: { userId: carolUser, deviceId: carolPhone, keys: keys.carol, role: "member" as GroupRole },
    };
    const directory = (): DirectoryDevice[] =>
      [alice, bob, carol].flatMap((record) =>
        record
          ? [{
              userId: record.device.ref.userId,
              deviceId: record.device.ref.deviceId,
              signingPublicKey: record.device.sophiaSigningPublicKey,
              role: record.device.role,
            }]
          : [],
      );
    const run = (who: keyof typeof people, record: GroupRecord | null) =>
      syncGroup({
        record,
        userId: people[who].userId,
        deviceId: people[who].deviceId,
        role: people[who].role,
        conversationId: groupId,
        signingPrivateJwk: people[who].keys.privateJwk,
        signingPublicKey: people[who].keys.publicKey,
        memberUserIds: [aliceUser, bobUser, ...(carol ? [carolUser] : [])],
        directory: directory(),
        blobs: log,
        post: post(people[who].deviceId),
      });

    alice = (await run("alice", null)).record;
    bob = (await run("bob", null)).record;
    alice = (await run("alice", alice)).record;
    bob = (await run("bob", bob)).record;

    // Freeze Bob before Alice's Add(Carol) commit advances the server epoch.
    const bobSnapshot: GroupRecord = {
      ...bob!,
      outbox: [...bob!.outbox],
      appliedBlobIds: [...bob!.appliedBlobIds],
      keyPackages: [...bob!.keyPackages],
    };
    carol = (await run("carol", null)).record;
    alice = (await run("alice", alice)).record;
    carol = (await run("carol", carol)).record;
    expect(serverEpoch).toBeGreaterThan(0);

    const stale = await queueGroupMessage(bobSnapshot, "sent while behind");
    const caughtUp = await run("bob", stale);
    expect(caughtUp.error).toBeNull();
    expect(caughtUp.record.outbox).toEqual([]);
    const aliceSees = await run("alice", alice);
    expect(aliceSees.messages.map((message) => message.plaintext)).toContain("sent while behind");
    expect(shouldReloadGroupBlobs({
      error: "MLS epoch is not the current group epoch",
      record: stale,
    })).toBe(true);
    expect(shouldReloadGroupBlobs({
      error: "Another member committed first. Sync again to retry.",
      record: caughtUp.record,
    })).toBe(true);
    expect(shouldReloadGroupBlobs({ error: null, record: caughtUp.record })).toBe(false);
    expect(shouldReloadGroupBlobs({
      error: null,
      record: stale,
    })).toBe(false);
  });

  it("keeps the sender plaintext and leaves an undecryptable message pending", async () => {
    const aliceKeys = await generateEd25519();
    const bobKeys = await generateEd25519();
    const log: GroupWireBlob[] = [];
    let stamp = 0;
    const post = (senderDeviceId: string) => async (body: {
      clientId: string;
      kind: GroupWireBlob["kind"];
      payload: string;
      recipientDeviceId?: string;
      bindingSignature?: string;
    }) => {
      stamp += 1;
      const id = `00000000-0000-4000-8000-${String(stamp).padStart(12, "0")}`;
      log.push({
        id,
        kind: body.kind,
        senderDeviceId,
        recipientDeviceId: body.recipientDeviceId ?? null,
        payload: body.payload,
        bindingSignature: body.bindingSignature ?? null,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, stamp)).toISOString(),
      });
      return { id, createdAt: log[log.length - 1]?.createdAt };
    };
    const directory = (records: Array<GroupRecord | null>): DirectoryDevice[] =>
      records.flatMap((record) => record
        ? [{
            userId: record.device.ref.userId,
            deviceId: record.device.ref.deviceId,
            signingPublicKey: record.device.sophiaSigningPublicKey,
            role: record.device.role,
          }]
        : []);
    let alice: GroupRecord | null = null;
    let bob: GroupRecord | null = null;
    const run = (who: "alice" | "bob", record: GroupRecord | null) => syncGroup({
      record,
      userId: who === "alice" ? aliceUser : bobUser,
      deviceId: who === "alice" ? alicePhone : bobPhone,
      role: who === "alice" ? "admin" : "member",
      conversationId: groupId,
      signingPrivateJwk: who === "alice" ? aliceKeys.privateJwk : bobKeys.privateJwk,
      signingPublicKey: who === "alice" ? aliceKeys.publicKey : bobKeys.publicKey,
      memberUserIds: [aliceUser, bobUser],
      directory: directory([alice, bob, record]),
      blobs: log,
      post: post(who === "alice" ? alicePhone : bobPhone),
    });

    alice = (await run("alice", alice)).record;
    bob = (await run("bob", bob)).record;
    alice = (await run("alice", alice)).record;
    bob = (await run("bob", bob)).record;

    alice = await queueGroupMessage(alice, SECRET);
    const sent = await run("alice", alice);
    expect(sent.messages.map((message) => message.plaintext)).toContain(SECRET);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveVaultKey("shared-device-password", salt);
    const reopened = await openGroupRecord(key, aliceUser, groupId, await sealGroupRecord(key, aliceUser, groupId, sent.record));
    expect(reopened.delivered?.map((message) => message.plaintext)).toContain(SECRET);
    expect(reopened.serverCursor).toBe(sent.record.serverCursor);
    alice = ackGroupDeliveries(sent.record, sent.messages.map((message) => message.id));
    expect(alice.delivered ?? []).toEqual([]);

    stamp += 1;
    const badId = `00000000-0000-4000-8000-${String(stamp).padStart(12, "0")}`;
    log.push({
      id: badId,
      kind: "application",
      senderDeviceId: alicePhone,
      recipientDeviceId: null,
      payload: "AAAA",
      bindingSignature: null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, stamp)).toISOString(),
    });
    const waiting = await run("bob", bob);
    expect(waiting.pending?.id).toBe(badId);
    expect(waiting.record.appliedBlobIds).not.toContain(badId);
    expect(mlsHistoryCursor(waiting.record)).not.toBe(badId);
    expect(waiting.messages.map((message) => message.plaintext)).not.toContain("AAAA");
  });
});

function privateMessageEpoch(payloadB64: string): number | null {
  const bytes = b64ToBytes(payloadB64);
  if (bytes.length < 12) return null;
  const version = (bytes[0]! << 8) | bytes[1]!;
  const wire = (bytes[2]! << 8) | bytes[3]!;
  if (version !== 1 || wire !== 2) return null;
  const first = bytes[4]!;
  if ((first >> 6) !== 0) return null;
  const groupLength = first & 0x3f;
  const epochAt = 5 + groupLength;
  if (epochAt + 8 > bytes.length) return null;
  let epoch = 0;
  for (let index = 0; index < 8; index += 1) {
    epoch = epoch * 256 + bytes[epochAt + index]!;
  }
  return epoch;
}

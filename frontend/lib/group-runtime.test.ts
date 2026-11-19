import { describe, expect, it } from "vitest";
import { generateEd25519 } from "./crypto/keys";
import { openGroupRecord, sealGroupRecord, type GroupRecord } from "./crypto/group-store";
import { deriveVaultKey } from "./crypto/kdf";
import {
  queueGroupMessage,
  queueSelfRemoval,
  syncGroup,
  type DirectoryDevice,
  type GroupWireBlob,
} from "./group-runtime";

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
});

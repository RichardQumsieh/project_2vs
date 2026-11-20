import { describe, expect, it } from "vitest";
import { bytesToB64 } from "./bytes";
import { emptySafetyStore } from "./safety-review";
import { buildSafetyView, reviewSafetyCard, type IdentityDirectory } from "./safety-view";

const viewer = "11111111-1111-4111-8111-111111111111";
const peer = "22222222-2222-4222-8222-222222222222";
const chat = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const groupId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

function key(byte: number): string {
  return bytesToB64(new Uint8Array(32).fill(byte));
}

function directory(identityByte: number): IdentityDirectory {
  return {
    conversationId: chat,
    type: "DIRECT",
    title: null,
    complete: true,
    incompleteReason: null,
    members: [
      {
        userId: viewer,
        username: "ada",
        displayName: "Ada",
        role: "MEMBER",
        devices: [{
          deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          deviceName: "phone",
          identityPublicKey: key(1),
          signingPublicKey: key(2),
        }],
      },
      {
        userId: peer,
        username: "sara",
        displayName: "Sara Haddad",
        role: "MEMBER",
        devices: [{
          deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
          deviceName: "phone",
          identityPublicKey: key(identityByte),
          signingPublicKey: key(4),
        }],
      },
    ],
  };
}

const local = {
  deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  identityPublicKey: key(1),
  signingPublicKey: key(2),
};

describe("safety view", () => {
  it("warns after a peer key change, then verifies only the new number", async () => {
    const first = await buildSafetyView({
      viewerUserId: viewer,
      local,
      directories: [directory(3)],
      store: emptySafetyStore(),
      now: "2026-11-20T00:00:00.000Z",
    });
    expect(first.cards[0]?.status).toBe("unverified");
    expect(first.cards[0]?.title).toBe("Sara Haddad");
    expect(first.cards[0]?.canVerify).toBe(true);
    expect(first.localWarning).toBeNull();
    const verified = await reviewSafetyCard(first, chat, "verify", "2026-11-20T00:01:00.000Z", local, viewer);
    expect(verified.cards[0]?.status).toBe("verified");
    expect(verified.cards[0]?.canVerify).toBe(false);

    const changed = await buildSafetyView({
      viewerUserId: viewer,
      local,
      directories: [directory(9)],
      store: verified.store,
      now: "2026-11-20T00:02:00.000Z",
    });
    expect(changed.cards[0]?.status).toBe("key_changed");
    expect(changed.cards[0]?.digits).not.toBe(verified.cards[0]?.digits);
    expect(changed.cards[0]?.qrPayload?.startsWith("sophia-safety-number/v1:")).toBe(true);
    expect(changed.cards[0]?.qrPayload?.includes(key(9))).toBe(false);
    expect(changed.cards[0]?.members.find((member) => member.userId === peer)?.changed).toBe(true);
    expect(changed.cards[0]?.canAccept).toBe(true);
    const accepted = await reviewSafetyCard(changed, chat, "accept", "2026-11-20T00:03:00.000Z", local, viewer);
    expect(accepted.cards[0]?.status).toBe("unverified");
    expect(accepted.store.conversations[chat]?.state).toBe("unverified");
  });

  it("does not offer verification when the server's copy of this browser does not match", async () => {
    const view = await buildSafetyView({
      viewerUserId: viewer,
      local: { ...local, identityPublicKey: key(7) },
      directories: [directory(3)],
      store: emptySafetyStore(),
      now: "2026-11-20T00:00:00.000Z",
    });
    expect(view.localWarning).toBe("mismatch");
    expect(view.cards[0]?.canVerify).toBe(false);
    expect(view.cards[0]?.digits).toMatch(/^\d{60}$/);
    const stuck = await reviewSafetyCard(view, chat, "verify", "2026-11-20T00:01:00.000Z", view.cards[0] ? local : null, viewer);
    expect(stuck.cards[0]?.status).toBe("unverified");
  });

  it("refuses a number when the directory is incomplete, including a group", async () => {
    const incomplete: IdentityDirectory = { ...directory(3), complete: false, incompleteReason: "too_many_devices" };
    const group: IdentityDirectory = {
      conversationId: groupId,
      type: "GROUP",
      title: "Leadership",
      complete: false,
      incompleteReason: "too_many_members",
      members: directory(3).members,
    };
    const view = await buildSafetyView({
      viewerUserId: viewer,
      local: null,
      directories: [incomplete, group],
      store: emptySafetyStore(),
      now: "2026-11-20T00:00:00.000Z",
    });
    expect(view.locked).toBe(true);
    expect(view.cards.map((card) => card.status)).toEqual(["incomplete", "incomplete"]);
    expect(view.cards.every((card) => card.digits === null && card.canVerify === false)).toBe(true);
    expect(view.store.conversations).toEqual({});
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRingingInvite } from "../src/call-invite.js";
import type { GroupCallRecord } from "../src/group-call.js";
import {
  CALL_TITLE,
  MESSAGE_TITLE,
  notificationCopy,
  payloadIsSafe,
  planNotifications,
  type RecipientSnapshot,
} from "../src/notifications-policy.js";
import { expoMessage, sendExpoPush, sendWebPush } from "../src/push-delivery.js";

const now = new Date("2026-11-28T12:00:00.000Z");

function recipient(overrides: Partial<RecipientSnapshot> = {}): RecipientSnapshot {
  return {
    userId: "user-b",
    hidePreviews: true,
    badgeCount: 2,
    muteExists: false,
    mutedUntil: null,
    openConversationId: null,
    openUntil: null,
    foregroundUntil: null,
    devices: [{ platform: "android", token: "ExponentPushToken[abc]" }],
    ...overrides,
  };
}

describe("notification planning", () => {
  it("sends ids only and a fixed visible template", () => {
    const plan = planNotifications({
      recipients: [recipient()],
      senderUserId: "user-a",
      conversationId: "11111111-1111-4111-8111-111111111111",
      now,
      kind: "message",
    });
    assert.equal(plan.deliveries.length, 1);
    const delivery = plan.deliveries[0]!;
    assert.equal(payloadIsSafe(delivery.payload), true);
    assert.equal(delivery.title, MESSAGE_TITLE);
    assert.equal(delivery.body, MESSAGE_TITLE);
    assert.equal(JSON.stringify(delivery.payload).includes("hello"), false);
    assert.equal(delivery.badge, 3);
    assert.equal(delivery.collapseKey, delivery.payload.conversationId);
    const wire = expoMessage(delivery);
    assert.equal(wire.title, MESSAGE_TITLE);
    assert.equal(JSON.stringify(wire).includes("displayName"), false);
  });

  it("skips the sender, muted chats, and the open conversation", () => {
    const plan = planNotifications({
      recipients: [
        recipient({ userId: "user-a" }),
        recipient({ userId: "user-c", muteExists: true, mutedUntil: null }),
        recipient({
          userId: "user-d",
          openConversationId: "11111111-1111-4111-8111-111111111111",
          openUntil: new Date(now.getTime() + 10_000),
        }),
        recipient({ userId: "user-e", devices: [] }),
      ],
      senderUserId: "user-a",
      conversationId: "11111111-1111-4111-8111-111111111111",
      now,
      kind: "message",
    });
    assert.deepEqual(plan.skipped.map((item) => item.reason), ["self", "muted", "open", "no-device"]);
    assert.equal(plan.deliveries.length, 0);
  });

  it("wakes a backgrounded device for a call without a sender name", () => {
    const plan = planNotifications({
      recipients: [
        recipient({ foregroundUntil: new Date(now.getTime() + 10_000) }),
        recipient({
          userId: "user-c",
          devices: [
            { platform: "android", token: "ExponentPushToken[phone]" },
            { platform: "web", token: "https://push.example/1", endpoint: "https://push.example/1", p256dh: "key", auth: "auth" },
          ],
        }),
      ],
      senderUserId: "user-a",
      conversationId: "22222222-2222-4222-8222-222222222222",
      now,
      kind: "call",
      call: {
        callId: "33333333-3333-4333-8333-333333333333",
        mode: "video",
        scope: "group",
      },
    });
    assert.equal(plan.skipped[0]?.reason, "foreground");
    assert.equal(plan.deliveries.length, 2);
    assert.equal(plan.deliveries[0]?.title, null);
    assert.equal(plan.deliveries[0]?.priority, "high");
    assert.equal(plan.deliveries[0]?.ttlSeconds, 30);
    assert.equal(payloadIsSafe(plan.deliveries[0]!.payload), true);
    assert.equal(plan.deliveries[0]?.payload.scope, "group");
    assert.equal(JSON.stringify(plan.deliveries[0]?.payload).includes(CALL_TITLE), false);
  });

  it("drops expired expo tokens and keeps web bodies to the id payload", async () => {
    const delivery = planNotifications({
      recipients: [recipient()],
      senderUserId: "user-a",
      conversationId: "11111111-1111-4111-8111-111111111111",
      now,
      kind: "message",
    }).deliveries[0]!;
    const expo = await sendExpoPush([delivery], (async () => new Response(JSON.stringify({
      data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch);
    assert.deepEqual(expo.dropTokens, ["ExponentPushToken[abc]"]);
    let body = "";
    const web = await sendWebPush([{
      ...delivery,
      platform: "web",
      token: "https://push.example/1",
      endpoint: "https://push.example/1",
      p256dh: "key",
      auth: "auth",
    }], async (input) => {
      body = input.body;
    });
    assert.equal(web.sent, 1);
    assert.equal(JSON.parse(body).kind, "message");
    assert.equal(Object.keys(JSON.parse(body)).sort().join(","), "conversationId,kind,senderId");
  });

  it("shows a sender preview only on the client when previews are allowed", () => {
    assert.equal(notificationCopy({ hidePreviews: true, senderName: "Ada", decryptedPreview: "secret", conversationOpen: false }).body, MESSAGE_TITLE);
    assert.equal(notificationCopy({ hidePreviews: false, senderName: "Ada", decryptedPreview: "secret", conversationOpen: false }).title, "Ada");
    assert.equal(notificationCopy({ hidePreviews: false, senderName: "Ada", decryptedPreview: "secret", conversationOpen: true }).show, false);
  });
});

describe("ringing invite fetch", () => {
  const invite = {
    callId: "33333333-3333-4333-8333-333333333333",
    conversationId: "22222222-2222-4222-8222-222222222222",
    senderId: "user-a",
    mode: "audio" as const,
    scope: "direct" as const,
    offer: { type: "offer" as const, sdp: "v=0" },
  };
  it("returns the offer only to the ringing callee", () => {
    const allowed = readRingingInvite({
      userId: "user-b",
      state: {
        conversationId: invite.conversationId,
        callerId: "user-a",
        calleeId: "user-b",
        status: "ringing",
      },
      invite,
    });
    assert.equal(allowed.ok, true);
    const caller = readRingingInvite({
      userId: "user-a",
      state: {
        conversationId: invite.conversationId,
        callerId: "user-a",
        calleeId: "user-b",
        status: "ringing",
      },
      invite,
    });
    assert.equal(caller.ok, false);
    const ended = readRingingInvite({
      userId: "user-b",
      state: {
        conversationId: invite.conversationId,
        callerId: "user-a",
        calleeId: "user-b",
        status: "active",
      },
      invite,
    });
    assert.equal(ended.ok, false);
    if (!ended.ok) assert.equal(ended.status, 409);
  });

  it("lets a group member who is not the caller fetch a ringing invite", () => {
    const state: GroupCallRecord = {
      kind: "group",
      conversationId: invite.conversationId,
      callerId: "user-a",
      mode: "video",
      participantIds: ["user-a", "user-b", "user-c"],
      joinedIds: ["user-a"],
      status: "ringing",
    };
    const member = readRingingInvite({
      userId: "user-c",
      state,
      invite: { ...invite, scope: "group", offer: undefined },
    });
    assert.equal(member.ok, true);
    const stranger = readRingingInvite({
      userId: "user-z",
      state,
      invite: { ...invite, scope: "group" },
    });
    assert.equal(stranger.ok, false);
  });
});

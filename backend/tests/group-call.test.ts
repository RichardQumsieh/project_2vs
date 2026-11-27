import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGroupMediaRoute,
  createGroupCall,
  joinGroupCall,
  leaveGroupCall,
  shouldCreateGroupOffer,
} from "../src/group-call.js";

const caller = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const cara = "33333333-3333-4333-8333-333333333333";

test("group call membership stays inside the conversation", () => {
  const created = createGroupCall({
    conversationId: "cc1bebdc-bf72-47fd-a15b-4c357d01b220",
    callerId: caller,
    mode: "video",
    memberIds: [caller, bob, cara],
  });
  assert.deepEqual(created.joinedIds, [caller]);
  assert.equal(created.status, "ringing");

  const joined = joinGroupCall(created, bob);
  assert.equal(joined.status, "active");
  assert.equal(joined.joinedIds.includes(bob), true);
  assert.throws(() => joinGroupCall(created, "44444444-4444-4444-8444-444444444444"), /not a participant/);

  assert.doesNotThrow(() => assertGroupMediaRoute(joined, caller, bob));
  assert.throws(() => assertGroupMediaRoute(joined, caller, cara), /Join the call/);
  assert.throws(() => assertGroupMediaRoute(joined, caller, caller), /yourself/);

  const afterLeave = leaveGroupCall(joined, cara);
  assert.equal(afterLeave.ended, false);
  assert.equal(afterLeave.state?.participantIds.includes(cara), false);
  const ended = leaveGroupCall(afterLeave.state!, bob);
  assert.equal(ended.ended, true);
  assert.equal(ended.state, null);
});

test("mesh offers are created by exactly one side of each pair", () => {
  assert.equal(shouldCreateGroupOffer(bob, caller), false);
  assert.equal(shouldCreateGroupOffer(caller, bob), true);
  assert.equal(shouldCreateGroupOffer(caller, caller), false);
});

test("group calls reject rooms outside the supported size", () => {
  assert.throws(() => createGroupCall({
    conversationId: "cc1bebdc-bf72-47fd-a15b-4c357d01b220",
    callerId: caller,
    mode: "audio",
    memberIds: [caller],
  }), /2 to 4/);
});

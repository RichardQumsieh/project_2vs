import assert from "node:assert/strict";
import test from "node:test";
import { allowTypingSignal, parseTypingSignal } from "../src/group-typing.js";

const groupId = "44444444-4444-4444-8444-444444444449";

test("typing signals carry a conversation id and no message text", () => {
  assert.deepEqual(parseTypingSignal({ type: "typing", conversationId: groupId, text: "secret" }), {
    conversationId: groupId,
  });
  assert.equal(parseTypingSignal({ type: "typing", conversationId: "not-an-id" }), null);
  assert.equal(parseTypingSignal({ type: "call:invite", conversationId: groupId }), null);
});

test("typing is limited to one signal per member every two seconds", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  assert.equal(allowTypingSignal(user, groupId, 1_000), true);
  assert.equal(allowTypingSignal(user, groupId, 1_500), false);
  assert.equal(allowTypingSignal(user, groupId, 3_100), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  canDeleteMessages,
  messageDeletionRecordIds,
} from "../src/message-deletion.js";

test("only the sender can delete every envelope for a logical message", () => {
  const messages = [
    { id: "envelope-1", logicalMessageId: "logical-1", senderUserId: "alice" },
    { id: "envelope-2", logicalMessageId: "logical-1", senderUserId: "alice" },
  ];

  assert.equal(canDeleteMessages(messages, "alice"), true);
  assert.equal(canDeleteMessages(messages, "bob"), false);
  assert.equal(
    canDeleteMessages([...messages, {
      id: "envelope-3",
      logicalMessageId: "logical-1",
      senderUserId: "bob",
    }], "alice"),
    false,
  );
  assert.equal(canDeleteMessages([], "alice"), false);
});

test("deletion record IDs include the logical ID and all device envelopes", () => {
  assert.deepEqual(
    messageDeletionRecordIds("logical-1", [
      { id: "envelope-1" },
      { id: "envelope-2" },
      { id: "envelope-1" },
    ]),
    ["logical-1", "envelope-1", "envelope-2"],
  );
});

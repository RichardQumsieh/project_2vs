import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canListConversation } from "../src/conversation-visibility.js";

describe("direct conversation visibility", () => {
  it("shows a newly initiated empty conversation only to its initiator", () => {
    const conversation = {
      initiatedByUserId: "alice",
      hasMessages: false,
    };

    assert.equal(
      canListConversation({ ...conversation, userId: "alice" }),
      true,
    );
    assert.equal(
      canListConversation({ ...conversation, userId: "bob" }),
      false,
    );
  });

  it("shows the conversation to both members after the first message", () => {
    const conversation = {
      initiatedByUserId: "alice",
      hasMessages: true,
    };

    assert.equal(
      canListConversation({ ...conversation, userId: "alice" }),
      true,
    );
    assert.equal(
      canListConversation({ ...conversation, userId: "bob" }),
      true,
    );
  });

  it("keeps historical conversations visible regardless of who initiated them", () => {
    assert.equal(
      canListConversation({
        initiatedByUserId: null,
        hasMessages: true,
        userId: "bob",
      }),
      true,
    );
  });
});

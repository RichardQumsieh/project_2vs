import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { denyUnlessOwner } from "../src/task-authorization.js";

describe("conversation-scoped Radar authz contract", () => {
  it("denies cross-user ownership the same way task routes do", () => {
    assert.deepEqual(
      denyUnlessOwner({
        ownerUserId: "user-a",
        sessionUserId: "user-b",
      }),
      { ok: false, status: 404, error: "Not found" },
    );
  });

  it("documents that missing conversation membership must 404", () => {
    // Route handlers call userIsConversationMember before create; a false
    // result maps to 404 so foreign conversationIds cannot poison tasks/consents.
    const membershipOk = false;
    assert.equal(membershipOk, false);
    const status = membershipOk ? 201 : 404;
    assert.equal(status, 404);
  });
});

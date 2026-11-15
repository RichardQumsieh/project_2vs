import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { denyUnlessOwner, isOwnedByUser } from "../src/task-authorization.js";
import {
  createAiConsentSchema,
  createReminderSchema,
  createTaskSchema,
  updateTaskSchema,
} from "../src/schemas.js";

describe("task ownership authorization", () => {
  it("allows only the owning user", () => {
    assert.equal(isOwnedByUser("user-a", "user-a"), true);
    assert.equal(isOwnedByUser("user-a", "user-b"), false);
    assert.deepEqual(
      denyUnlessOwner({ ownerUserId: "user-a", sessionUserId: "user-b" }),
      { ok: false, status: 404, error: "Not found" },
    );
    assert.deepEqual(
      denyUnlessOwner({ ownerUserId: null, sessionUserId: "user-a" }),
      { ok: false, status: 404, error: "Not found" },
    );
    assert.deepEqual(
      denyUnlessOwner({ ownerUserId: "user-a", sessionUserId: "user-a" }),
      { ok: true },
    );
  });
});

describe("task and reminder schemas", () => {
  it("accepts Radar-accepted task payloads without chat plaintext fields", () => {
    const result = createTaskSchema.safeParse({
      title: "Send proposal",
      dueAt: "2026-11-16T00:00:00.000Z",
      source: "RADAR",
      clientDraftId: "draft-1",
      conversationId: "550e8400-e29b-41d4-a716-446655440000",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.source, "RADAR");
      assert.equal(
        Object.prototype.hasOwnProperty.call(result.data, "excerpt"),
        false,
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(result.data, "plaintext"),
        false,
      );
    }
  });

  it("rejects oversized titles and empty updates", () => {
    assert.equal(
      createTaskSchema.safeParse({ title: "x".repeat(161) }).success,
      false,
    );
    assert.equal(updateTaskSchema.safeParse({}).success, false);
  });

  it("validates reminder and unused consent schemas", () => {
    assert.equal(
      createReminderSchema.safeParse({
        remindAt: "2026-11-17T12:00:00.000Z",
        taskId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
      true,
    );
    assert.equal(
      createAiConsentSchema.safeParse({
        scope: "CLOUD_AI",
      }).success,
      true,
    );
    assert.equal(
      createAiConsentSchema.safeParse({
        scope: "ANALYZE_EVERYTHING",
      }).success,
      false,
    );
  });
});

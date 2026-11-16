import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listMessagesQuery } from "../src/schemas.js";

describe("message history pagination", () => {
  it("accepts a composite cursor", () => {
    const result = listMessagesQuery.safeParse({
      before: "2026-10-29T22:00:00.000Z",
      beforeId: "11111111-1111-4111-8111-111111111111",
    });

    assert.equal(result.success, true);
  });

  it("rejects a timestamp cursor without its message ID", () => {
    const result = listMessagesQuery.safeParse({
      before: "2026-10-29T22:00:00.000Z",
    });

    assert.equal(result.success, false);
  });

  it("rejects combining forward and backward cursors", () => {
    const result = listMessagesQuery.safeParse({
      after: "11111111-1111-4111-8111-111111111111",
      before: "2026-10-29T22:00:00.000Z",
      beforeId: "22222222-2222-4222-8222-222222222222",
    });

    assert.equal(result.success, false);
  });

  it("accepts a from-start cursor for ordered history backup", () => {
    const result = listMessagesQuery.safeParse({
      fromStart: "true",
      limit: "100",
    });

    assert.equal(result.success, true);
  });

  it("rejects combining from-start and other cursors", () => {
    const result = listMessagesQuery.safeParse({
      fromStart: "true",
      after: "11111111-1111-4111-8111-111111111111",
    });

    assert.equal(result.success, false);
  });
});

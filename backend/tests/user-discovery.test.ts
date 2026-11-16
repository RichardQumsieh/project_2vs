import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { updateProfileSchema } from "../src/schemas.js";

describe("user discovery profile interests", () => {
  it("normalizes and deduplicates explicit interests", () => {
    const result = updateProfileSchema.safeParse({
      interests: [" Hiking ", "photography", "hiking"],
    });

    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.data.interests, ["hiking", "photography"]);
    }
  });

  it("limits the number and length of interests", () => {
    assert.equal(
      updateProfileSchema.safeParse({
        interests: Array.from({ length: 21 }, (_, index) => `interest-${index}`),
      }).success,
      false,
    );
    assert.equal(
      updateProfileSchema.safeParse({
        interests: ["x".repeat(41)],
      }).success,
      false,
    );
  });

  it("rejects empty interest entries", () => {
    assert.equal(
      updateProfileSchema.safeParse({ interests: ["  "] }).success,
      false,
    );
  });
});

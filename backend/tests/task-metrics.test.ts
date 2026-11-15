import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bumpTaskMetric, snapshotTaskMetrics } from "../src/task-metrics.js";

describe("task route metrics", () => {
  it("bumps opaque counters without storing titles or plaintext", () => {
    const before = snapshotTaskMetrics().tasks_created_count;
    assert.equal(bumpTaskMetric("tasks_created_count"), before + 1);
    assert.equal(snapshotTaskMetrics().tasks_created_count, before + 1);
    assert.equal(
      Object.keys(snapshotTaskMetrics()).every((key) =>
        key.endsWith("_count"),
      ),
      true,
    );
  });
});

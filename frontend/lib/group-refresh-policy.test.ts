import { describe, expect, it } from "vitest";
import { shouldReloadGroupBlobs } from "./group-runtime";
import type { GroupRecord } from "./crypto/group-store";

function recordWithOutbox(
  kinds: Array<"application" | "commit" | "proposal">,
): GroupRecord {
  return {
    outbox: kinds.map((kind) => ({
      clientId: `c-${kind}`,
      kind,
      payload: new Uint8Array([1]),
      ...(kind === "application" ? { plaintext: "hi" } : {}),
    })),
  } as GroupRecord;
}

describe("shouldReloadGroupBlobs", () => {
  it("reloads only for epoch-race errors", () => {
    const empty = recordWithOutbox([]);
    expect(shouldReloadGroupBlobs({
      error: "MLS epoch is not the current group epoch",
      record: empty,
    })).toBe(true);
    expect(shouldReloadGroupBlobs({
      error: "Another member committed first. Sync again to retry.",
      record: empty,
    })).toBe(true);
  });

  it("does not reload merely because outbox still has work", () => {
    expect(shouldReloadGroupBlobs({
      error: null,
      record: recordWithOutbox(["application", "commit"]),
    })).toBe(false);
  });

  it("does not reload on unrelated errors", () => {
    expect(shouldReloadGroupBlobs({
      error: "Could not upload a group update",
      record: recordWithOutbox(["commit"]),
    })).toBe(false);
  });
});

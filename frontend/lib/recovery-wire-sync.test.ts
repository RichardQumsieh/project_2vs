import { describe, expect, it } from "vitest";
import { isGroupEnvelopeRejection, shouldFetchPairwiseWireHistory } from "./recovery-wire-sync";

describe("shouldFetchPairwiseWireHistory", () => {
  it("uses pairwise envelopes only for DIRECT conversations", () => {
    expect(shouldFetchPairwiseWireHistory("DIRECT")).toBe(true);
  });

  it("skips pairwise wire fetch for GROUP conversations (MLS + archive)", () => {
    expect(shouldFetchPairwiseWireHistory("GROUP")).toBe(false);
  });

  it("treats the group pairwise 409 as a skip, not a failed history sync", () => {
    expect(isGroupEnvelopeRejection({
      status: 409,
      message: "Group conversations accept MLS blobs, not pairwise envelopes.",
    })).toBe(true);
    expect(isGroupEnvelopeRejection(new Error("network"))).toBe(false);
  });
});

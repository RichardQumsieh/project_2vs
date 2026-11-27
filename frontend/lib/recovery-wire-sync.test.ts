import { describe, expect, it } from "vitest";
import { shouldFetchPairwiseWireHistory } from "./recovery-wire-sync";

describe("shouldFetchPairwiseWireHistory", () => {
  it("uses pairwise envelopes only for DIRECT conversations", () => {
    expect(shouldFetchPairwiseWireHistory("DIRECT")).toBe(true);
  });

  it("skips pairwise wire fetch for GROUP conversations (MLS + archive)", () => {
    expect(shouldFetchPairwiseWireHistory("GROUP")).toBe(false);
  });
});

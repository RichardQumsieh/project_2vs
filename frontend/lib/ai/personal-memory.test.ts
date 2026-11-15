import { describe, expect, it } from "vitest";
import {
  addMemoryFact,
  formatMemoryForPrompt,
  parseMemoryFacts,
  removeMemoryFact,
} from "./personal-memory";

describe("on-device Jarvis personal memory", () => {
  it("bounds, trims, and rejects oversized facts", () => {
    const facts = addMemoryFact([], "  Manager reviews are on Thursdays  ", {
      id: "m1",
      createdAt: "2026-11-13T00:00:00.000Z",
    });
    expect(facts).toEqual([
      {
        id: "m1",
        text: "Manager reviews are on Thursdays",
        createdAt: "2026-11-13T00:00:00.000Z",
      },
    ]);
    expect(() => addMemoryFact([], "x".repeat(241))).toThrow("1 to 240");
    expect(parseMemoryFacts([{ id: "bad" }])).toEqual([]);
  });

  it("deduplicates, forgets by query, and quotes facts for prompts", () => {
    const first = addMemoryFact([], "I work on Atlas", {
      id: "a",
      createdAt: "2026-11-13T00:00:00.000Z",
    });
    const second = addMemoryFact(first, "I work on Atlas", {
      id: "b",
      createdAt: "2026-11-13T00:00:00.000Z",
    });
    expect(second).toHaveLength(1);
    expect(removeMemoryFact(first, { text: "atlas" })).toEqual([]);
    expect(formatMemoryForPrompt(first)).toEqual(['"I work on Atlas"']);
  });
});

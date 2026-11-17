import { describe, expect, it } from "vitest";
import {
  addMemoryFact,
  formatMemoryForPrompt,
  loadPersonalMemory,
  parseMemoryFacts,
  removeMemoryFact,
  savePersonalMemory,
} from "./personal-memory";

describe("on-device Sophia personal memory", () => {
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

  it("migrates legacy jarvis-memory localStorage keys once", () => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => memory.get(key) ?? null,
          setItem: (key: string, value: string) => {
            memory.set(key, value);
          },
          removeItem: (key: string) => {
            memory.delete(key);
          },
        },
      },
    });
    memory.set(
      "private-messenger:jarvis-memory:user-1",
      JSON.stringify([
        {
          id: "m1",
          text: "Migrated note",
          createdAt: "2026-11-13T00:00:00.000Z",
        },
      ]),
    );
    const facts = loadPersonalMemory("user-1");
    expect(facts).toEqual([
      {
        id: "m1",
        text: "Migrated note",
        createdAt: "2026-11-13T00:00:00.000Z",
      },
    ]);
    expect(memory.has("private-messenger:sophia-memory:user-1")).toBe(true);
    expect(memory.has("private-messenger:jarvis-memory:user-1")).toBe(false);
    savePersonalMemory("user-1", facts);
    expect(memory.has("private-messenger:jarvis-memory:user-1")).toBe(false);
    Reflect.deleteProperty(globalThis, "window");
  });
});

import { describe, expect, it } from "vitest";
import { bumpDmUnread, clearDmUnread, loadDmUnread, saveDmUnread } from "./dm-unread";

describe("dm unread map", () => {
  it("bumps, clears, and round-trips through storage", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    } as Storage;

    let map = bumpDmUnread({}, "c1");
    map = bumpDmUnread(map, "c1");
    expect(map.c1).toBe(2);
    saveDmUnread("user-1", map, storage);
    expect(loadDmUnread("user-1", storage)).toEqual({ c1: 2 });
    map = clearDmUnread(map, "c1");
    saveDmUnread("user-1", map, storage);
    expect(loadDmUnread("user-1", storage)).toEqual({});
  });
});

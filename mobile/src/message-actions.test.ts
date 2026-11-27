import { describe, expect, it } from "vitest";
import { deleteScopes, swipeIntent, swipeOpenAction } from "./message-actions";

describe("message swipe actions", () => {
  it("maps a right swipe to delete and a left swipe to reply", () => {
    expect(swipeIntent(90)).toBe("delete");
    expect(swipeIntent(-90)).toBe("reply");
    expect(swipeIntent(10)).toBeNull();
    expect(swipeOpenAction("right")).toBe("delete");
    expect(swipeOpenAction("left")).toBe("reply");
  });

  it("offers delete-for-everyone only for a sent message from this account", () => {
    expect(deleteScopes({ fromMe: true, pending: false })).toEqual(["me", "everyone"]);
    expect(deleteScopes({ fromMe: true, pending: true })).toEqual(["me"]);
    expect(deleteScopes({ fromMe: false, pending: false })).toEqual(["me"]);
  });
});

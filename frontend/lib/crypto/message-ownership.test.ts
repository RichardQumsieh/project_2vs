import { describe, expect, it } from "vitest";
import { isMessageFromUser } from "./message-ownership";

describe("message sender ownership", () => {
  it("uses the authoritative sender account rather than cached presentation state", () => {
    expect(
      isMessageFromUser("alice", "alice-device", "bob", "bob-device"),
    ).toBe(false);
    expect(
      isMessageFromUser("alice", "alice-device", "alice", "bob-device"),
    ).toBe(true);
  });

  it("uses the current device only for legacy messages without sender account metadata", () => {
    expect(
      isMessageFromUser(undefined, "alice-device", "bob", "bob-device"),
    ).toBe(false);
    expect(
      isMessageFromUser(undefined, "bob-device", "bob", "bob-device"),
    ).toBe(true);
  });
});

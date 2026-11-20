import { describe, expect, it } from "vitest";
import { inviteCodeFromInput } from "./invite-code";

describe("invite codes", () => {
  it("reads a code from a link or a pasted token", () => {
    expect(inviteCodeFromInput("https://sophia.example/join?code=abcd2345efgh")).toBe("ABCD2345EFGH");
    expect(inviteCodeFromInput("  abcd2345efgh ")).toBe("ABCD2345EFGH");
    expect(inviteCodeFromInput("short")).toBeNull();
    expect(inviteCodeFromInput("")).toBeNull();
  });
});
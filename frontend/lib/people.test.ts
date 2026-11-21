import { describe, expect, it } from "vitest";
import { memberSearchNeedle } from "./people";

describe("member search", () => {
  it("treats @username and a display name as the same kind of query", () => {
    expect(memberSearchNeedle("@benjoe")).toBe("benjoe");
    expect(memberSearchNeedle("  Ben   Joe ")).toBe("ben joe");
    expect("benjoe".includes(memberSearchNeedle("@benjoe"))).toBe(true);
    expect("ben joe".includes(memberSearchNeedle("Ben Joe"))).toBe(true);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { dailyBriefEnabled } from "./flag";

describe("daily brief flag", () => {
  const previous = process.env.NEXT_PUBLIC_DAILY_BRIEF_ENABLED;

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_DAILY_BRIEF_ENABLED;
    else process.env.NEXT_PUBLIC_DAILY_BRIEF_ENABLED = previous;
  });

  it("stays on unless the public flag is exactly false", () => {
    delete process.env.NEXT_PUBLIC_DAILY_BRIEF_ENABLED;
    expect(dailyBriefEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_DAILY_BRIEF_ENABLED = "";
    expect(dailyBriefEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_DAILY_BRIEF_ENABLED = "true";
    expect(dailyBriefEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_DAILY_BRIEF_ENABLED = "false";
    expect(dailyBriefEnabled()).toBe(false);
  });
});

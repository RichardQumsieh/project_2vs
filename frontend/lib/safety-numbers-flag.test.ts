import { afterEach, describe, expect, it } from "vitest";
import { assertSafetyNumbersEnabled, safetyNumbersEnabled } from "./safety-numbers-flag";

describe("safety number flag", () => {
  const previous = process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED;

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED;
    else process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED = previous;
  });

  it("stays off unless the public flag is exactly true", () => {
    delete process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED;
    expect(safetyNumbersEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED = "false";
    expect(safetyNumbersEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED = "true";
    expect(safetyNumbersEnabled()).toBe(true);
  });

  it("refuses to call the directory API while the flag is off", () => {
    delete process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED;
    expect(() => assertSafetyNumbersEnabled()).toThrow(/SAFETY_NUMBERS_ENABLED/);
  });
});

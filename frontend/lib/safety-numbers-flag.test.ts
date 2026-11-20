import { afterEach, describe, expect, it } from "vitest";
import { assertSafetyNumbersEnabled, safetyNumbersEnabled } from "./safety-numbers-flag";

describe("safety number flag", () => {
  const previous = process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED;

  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED;
    else process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED = previous;
  });

  it("stays on unless the public flag is exactly false", () => {
    delete process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED;
    expect(safetyNumbersEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED = "";
    expect(safetyNumbersEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED = "true";
    expect(safetyNumbersEnabled()).toBe(true);
    process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED = "false";
    expect(safetyNumbersEnabled()).toBe(false);
  });

  it("refuses to call the directory API only when the flag is false", () => {
    delete process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED;
    expect(() => assertSafetyNumbersEnabled()).not.toThrow();
    process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED = "false";
    expect(() => assertSafetyNumbersEnabled()).toThrow(/NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED is false/);
  });
});

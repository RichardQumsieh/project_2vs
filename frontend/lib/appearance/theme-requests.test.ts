import { describe, expect, it } from "vitest";
import { parseThemeRequest } from "./theme-requests";

describe("parseThemeRequest", () => {
  it("applies a Spiderman theme", () => {
    const request = parseThemeRequest("I want a spiderman theme");
    expect(request?.label).toBe("spiderman");
    expect(request?.tokens.colorMode).toBe("dark");
    expect(request?.tokens.accent).toBe("#e11d48");
    expect(request?.motion.kind).toBe("none");
  });

  it("rotates nature scenes on an interval", () => {
    const request = parseThemeRequest(
      "I want a theme that changes every 10 seconds to nature scenes",
    );
    expect(request?.label).toBe("nature-rotate");
    expect(request?.motion.kind).toBe("rotate");
    if (request?.motion.kind === "rotate") {
      expect(request.motion.intervalMs).toBe(10_000);
      expect(request.motion.frames.length).toBeGreaterThan(1);
    }
  });
});

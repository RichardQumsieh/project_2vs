import { describe, expect, it } from "vitest";
import {
  buildExternalMapsUrl,
  describeLocationAccuracy,
  formatCoordinate,
  roundCoordinate,
} from "./location-share";

describe("location sharing helpers", () => {
  it("rounds and formats coordinates for stable payloads", () => {
    expect(roundCoordinate(31.953912345)).toBe(31.953912);
    expect(formatCoordinate(31.953912)).toBe("31.95391");
  });

  it("builds an explicit OpenStreetMap URL and describes accuracy", () => {
    expect(buildExternalMapsUrl(31.95, 35.91)).toContain("openstreetmap.org");
    expect(describeLocationAccuracy(12.4)).toBe("Accurate to about 12 m");
    expect(describeLocationAccuracy(undefined)).toBeNull();
  });
});

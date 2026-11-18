import { describe, expect, it, vi } from "vitest";
import {
  GEOLOCATION_PERMISSION_DENIED,
  GEOLOCATION_TIMEOUT,
  buildExternalMapsUrl,
  describeLocationAccuracy,
  formatCoordinate,
  locationErrorMessage,
  readBrowserLocationWith,
  roundCoordinate,
  type LocationReadDeps,
} from "./location-share";

const fix = {
  latitude: 31.953912345,
  longitude: 35.910001,
  accuracy: 12.4,
  altitude: 800,
  timestamp: Date.parse("2026-11-18T12:00:00.000Z"),
};

function deps(
  overrides: Partial<LocationReadDeps> = {},
): LocationReadDeps {
  return {
    secureContext: true,
    supported: true,
    queryPermission: async () => "granted",
    readPosition: async () => fix,
    wait: async () => {},
    ...overrides,
  };
}

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

describe("readBrowserLocationWith", () => {
  it("shares when permission is granted", async () => {
    const location = await readBrowserLocationWith(deps());
    expect(location.lat).toBe(31.953912);
    expect(location.lon).toBe(35.910001);
    expect(location.accuracy).toBe(12.4);
    expect(location.sharedAt).toBe("2026-11-18T12:00:00.000Z");
  });

  it("retries once after a grant that the first read reports as denied", async () => {
    const readPosition = vi
      .fn()
      .mockRejectedValueOnce({ code: GEOLOCATION_PERMISSION_DENIED })
      .mockResolvedValueOnce(fix);
    let checks = 0;
    const location = await readBrowserLocationWith(
      deps({
        queryPermission: async () => {
          checks += 1;
          return checks === 1 ? "prompt" : "granted";
        },
        readPosition,
      }),
    );
    expect(location.lat).toBe(31.953912);
    expect(readPosition).toHaveBeenCalledTimes(2);
  });

  it("does not say permission was denied when the permission state is granted", async () => {
    const readPosition = vi
      .fn()
      .mockRejectedValue({ code: GEOLOCATION_PERMISSION_DENIED });
    await expect(
      readBrowserLocationWith(
        deps({
          queryPermission: async () => "granted",
          readPosition,
        }),
      ),
    ).rejects.toThrow(/permission is granted/i);
    await expect(
      readBrowserLocationWith(
        deps({
          queryPermission: async () => "granted",
          readPosition,
        }),
      ),
    ).rejects.not.toThrow(/was denied/i);
    expect(
      locationErrorMessage({
        secureContext: true,
        permission: "granted",
        code: GEOLOCATION_PERMISSION_DENIED,
      }),
    ).not.toMatch(/was denied/i);
  });

  it("explains an insecure page and a real denial without reading a fix", async () => {
    const readPosition = vi.fn();
    await expect(
      readBrowserLocationWith(
        deps({ secureContext: false, readPosition }),
      ),
    ).rejects.toThrow(/secure HTTPS/i);
    await expect(
      readBrowserLocationWith(
        deps({
          queryPermission: async () => "denied",
          readPosition,
        }),
      ),
    ).rejects.toThrow(/was denied/i);
    expect(readPosition).not.toHaveBeenCalled();
    await expect(
      readBrowserLocationWith(
        deps({
          queryPermission: async () => "prompt",
          readPosition: async () => {
            throw { code: GEOLOCATION_TIMEOUT };
          },
        }),
      ),
    ).rejects.toThrow(/Timed out/i);
  });
});

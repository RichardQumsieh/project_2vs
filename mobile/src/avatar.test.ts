import { describe, expect, it } from "vitest";
import { defaultAvatar, randomAvatar, parseAvatarConfig } from "../../frontend/lib/avatar/config";
import { buildAvatar } from "../../frontend/lib/avatar/geometry";
import { presentationMode } from "../../frontend/lib/avatar/greeting";
import { renderAvatarPng } from "../../frontend/lib/avatar/thumbnail";

describe("mobile avatar snapshots", () => {
  it("reuses the shared low-poly portrait instead of a GL view in lists", () => {
    const png = renderAvatarPng(defaultAvatar());
    expect(png[0]).toBe(137);
    expect(png.byteLength).toBeLessThan(20_000);
    const busy = buildAvatar(randomAvatar(() => 0.2));
    expect(busy.stats.drawCalls).toBeLessThanOrEqual(4);
    expect(busy.stats.triangles).toBeLessThan(2000);
    expect(parseAvatarConfig(defaultAvatar())?.v).toBe(1);
    expect(presentationMode({ focused: false, staticAvatars: false, glFailed: false })).toBe("still");
    expect(presentationMode({ focused: true, staticAvatars: false, glFailed: true })).toBe("still");
  });
});

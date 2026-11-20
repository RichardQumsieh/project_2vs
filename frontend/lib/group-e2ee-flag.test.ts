import { describe, expect, it } from "vitest";
import { api } from "./api";
import { assertGroupE2eeEnabled, groupE2eeEnabled } from "./group-e2ee-flag";

describe("group E2EE feature flag", () => {
  it("is on unless the public env flag is exactly false", () => {
    const previous = process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED;
    delete process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED;
    expect(groupE2eeEnabled()).toBe(true);
    expect(() => assertGroupE2eeEnabled()).not.toThrow();
    process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED = "false";
    expect(groupE2eeEnabled()).toBe(false);
    expect(() => assertGroupE2eeEnabled()).toThrow(/disabled/i);
    process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED = "true";
    expect(groupE2eeEnabled()).toBe(true);
    if (previous === undefined) delete process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED;
    else process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED = previous;
  });

  it("does not call the network while the client flag is off", async () => {
    const previous = process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED;
    process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED = "false";
    expect(() => api.createGroup({ memberUserIds: [] })).toThrow(/disabled/i);
    if (previous === undefined) delete process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED;
    else process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED = previous;
  });
});

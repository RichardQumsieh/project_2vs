import { describe, expect, it } from "vitest";
import { isKnownLocalDevice } from "./known-device";

describe("known device", () => {
  it("recognizes a vault whose device still belongs to the account", () => {
    expect(isKnownLocalDevice({
      hasVault: true,
      vaultVersion: 2,
      accountVaultVersion: 2,
      deviceId: "device-1",
      accountDeviceIds: ["device-1", "device-2"],
    })).toBe(true);
  });

  it("treats a missing version as version 1", () => {
    expect(isKnownLocalDevice({
      hasVault: true,
      vaultVersion: undefined,
      accountVaultVersion: 1,
      deviceId: "device-1",
      accountDeviceIds: ["device-1"],
    })).toBe(true);
  });

  it("rejects a revoked device, a version mismatch, or an empty vault", () => {
    expect(isKnownLocalDevice({
      hasVault: true,
      vaultVersion: 1,
      accountVaultVersion: 1,
      deviceId: "gone",
      accountDeviceIds: ["device-1"],
    })).toBe(false);
    expect(isKnownLocalDevice({
      hasVault: true,
      vaultVersion: 1,
      accountVaultVersion: 2,
      deviceId: "device-1",
      accountDeviceIds: ["device-1"],
    })).toBe(false);
    expect(isKnownLocalDevice({
      hasVault: false,
      vaultVersion: 1,
      accountVaultVersion: 1,
      deviceId: "device-1",
      accountDeviceIds: ["device-1"],
    })).toBe(false);
  });
});

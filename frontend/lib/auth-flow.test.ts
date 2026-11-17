import { describe, expect, it } from "vitest";
import { loginScreens, shouldAskForDriveRecovery, signupScreens } from "./auth-flow";

describe("auth step order", () => {
  it("keeps signup staged", () => {
    expect(signupScreens).toEqual([
      "profile",
      "email",
      "password",
      "authenticator",
      "recovery",
    ]);
  });

  it("asks a new device for password, authenticator, then Drive recovery", () => {
    expect(loginScreens({ trusted: false, known: false })).toEqual([
      "credentials",
      "totp",
      "drive",
    ]);
  });

  it("skips the authenticator when the browser is already trusted", () => {
    expect(loginScreens({ trusted: true, known: true })).toEqual(["credentials"]);
    expect(loginScreens({ trusted: true, known: false })).toEqual(["credentials"]);
    expect(shouldAskForDriveRecovery({ trusted: true, known: false })).toBe(false);
  });

  it("skips Drive recovery on a known device that still needs the authenticator", () => {
    expect(loginScreens({ trusted: false, known: true })).toEqual([
      "credentials",
      "totp",
    ]);
  });

  it("puts unfinished authenticator setup on its own step", () => {
    expect(loginScreens({ trusted: false, known: false, setupRequired: true })).toEqual([
      "credentials",
      "enroll",
    ]);
  });

  it("asks for Drive recovery when the archive stays locked", () => {
    expect(loginScreens({
      trusted: true,
      known: true,
      archiveLocked: true,
    })).toEqual(["credentials", "drive"]);
    expect(shouldAskForDriveRecovery({
      trusted: false,
      known: true,
      archiveLocked: true,
    })).toBe(true);
  });
});

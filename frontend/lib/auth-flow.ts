export const signupScreens = [
  "profile",
  "email",
  "password",
  "authenticator",
  "recovery",
] as const;

export type SignupScreen = (typeof signupScreens)[number];

export type LoginScreen = "credentials" | "totp" | "drive" | "enroll";

/**
 * Login is never one combined form.
 * 1. Email and password.
 * 2. Six-digit authenticator, unless this browser is already trusted.
 * 3. Google Drive recovery only when the device is neither trusted nor known.
 * Archive unlock failures still ask for that recovery code on its own step.
 */
export function loginScreens(input: {
  trusted: boolean;
  known: boolean;
  setupRequired?: boolean;
  archiveLocked?: boolean;
}): LoginScreen[] {
  if (input.setupRequired) {
    const screens: LoginScreen[] = ["credentials", "enroll"];
    if (input.archiveLocked) screens.push("drive");
    return screens;
  }

  const screens: LoginScreen[] = ["credentials"];
  if (!input.trusted) screens.push("totp");
  if (input.archiveLocked || (!input.trusted && !input.known)) screens.push("drive");
  return screens;
}

export function shouldAskForDriveRecovery(input: {
  trusted: boolean;
  known: boolean;
  archiveLocked?: boolean;
}) {
  return loginScreens(input).includes("drive");
}

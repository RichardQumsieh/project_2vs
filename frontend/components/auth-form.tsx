"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { PasswordRules } from "@/components/password-rules";
import { ApiError, api, type TotpSetup } from "@/lib/api";
import { shouldAskForDriveRecovery } from "@/lib/auth-flow";
import { decryptAccountArchiveDriveBackup } from "@/lib/crypto/account-archive";
import {
  downloadGoogleDriveArchiveBackup,
  isGoogleDriveArchiveConfigured,
  loadGoogleIdentityServices,
  requestGoogleDriveAccessToken,
} from "@/lib/google-drive-archive";
import { loadDeviceId, loadVault } from "@/lib/idb";
import { isKnownLocalDevice } from "@/lib/known-device";
import { passwordIsReady, passwordPolicyFailure } from "@/lib/password-policy";
import {
  acknowledgeArchiveRecoveryCode,
  bootstrapDevice,
  cryptoSupported,
  lockDevice,
} from "@/lib/session";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/lib/validators";

const controlClass =
  "h-12 w-full rounded-xl border border-(--line) bg-(--control-bg) px-3 text-base text-(--foreground) outline-none placeholder:text-(--muted) focus-visible:border-(--accent)";

const primaryButton =
  "inline-flex h-11 w-full items-center justify-center rounded-full bg-(--foreground) px-5 text-sm font-medium text-(--background) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)";

const secondaryButton =
  "inline-flex h-11 w-full items-center justify-center rounded-full border border-(--line) bg-(--control-bg) px-5 text-sm font-medium text-(--foreground) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)";

const credentialsSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
});

function isArchiveError(error: unknown) {
  return error instanceof Error && (
    error.message === "ARCHIVE_RECOVERY_CODE_REQUIRED" ||
    error.message === "INVALID_ARCHIVE_RECOVERY_CODE"
  );
}

function messageFrom(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "ARCHIVE_RECOVERY_CODE_REQUIRED") {
    return "Enter the Google Drive recovery code to unlock encrypted history on this device.";
  }
  if (error instanceof Error && error.message === "INVALID_ARCHIVE_RECOVERY_CODE") {
    return "That recovery code is not valid. Check it and try again.";
  }
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionCheckError, setSessionCheckError] = useState<string | null>(null);
  const [sessionCheckAttempt, setSessionCheckAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    void api.me().then(
      () => {
        router.replace("/inbox");
      },
      (error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setCheckingSession(false);
          return;
        }
        setSessionCheckError(
          error instanceof ApiError
            ? `The session service returned an error (${error.status}): ${error.message}`
            : error instanceof Error
              ? `Could not reach the session service: ${error.message}`
              : "Could not verify the current session because of an unexpected error.",
        );
        setCheckingSession(false);
      },
    );

    return () => {
      active = false;
    };
  }, [router, sessionCheckAttempt]);

  if (checkingSession) {
    return <p role="status" className="text-sm text-(--muted)">Checking your session…</p>;
  }

  if (sessionCheckError) {
    return (
      <div className="space-y-4 text-center">
        <p role="alert" className="text-sm text-(--danger)">
          Could not verify your current session. {sessionCheckError}
        </p>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            setCheckingSession(true);
            setSessionCheckError(null);
            setSessionCheckAttempt((attempt) => attempt + 1);
          }}
        >
          Retry session check
        </button>
      </div>
    );
  }

  return mode === "signup" ? <SignupForm /> : <LoginForm />;
}

function SignupForm() {
  const router = useRouter();
  const [step, setStep] = useState<"profile" | "email" | "password" | "enroll" | "codes">("profile");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [archiveRecoveryCode, setArchiveRecoveryCode] = useState<string | null>(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordReady = passwordIsReady(password, passwordConfirm, email);

  async function confirmAuthenticatorCode(code: string, trustBrowser: boolean) {
    if (!setup) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.confirmTotp({
        setupToken: setup.setupToken,
        code,
        trustBrowser,
      });
      const device = await bootstrapDevice(password);
      setRecoveryCodes(result.recoveryCodes);
      setArchiveRecoveryCode(device.archiveRecoveryCode ?? null);
      setVaultReady(true);
      setSetup(null);
      setStep("codes");
    } catch (err) {
      setError(messageFrom(err, "Could not finish secure device setup. Retry and check browser storage and the API connection."));
    } finally {
      setSubmitting(false);
    }
  }

  async function continueToInbox() {
    setError(null);
    setSubmitting(true);
    try {
      if (!vaultReady) {
        const device = await bootstrapDevice(password);
        if (device.archiveRecoveryCode) {
          setArchiveRecoveryCode(device.archiveRecoveryCode);
          setRecoveryCodes((current) => current ?? []);
          setVaultReady(true);
          return;
        }
        setVaultReady(true);
      }
      if (archiveRecoveryCode) await acknowledgeArchiveRecoveryCode();
      router.replace("/inbox");
    } catch (err) {
      setError(messageFrom(err, "Authenticator setup is complete, but secure device setup failed. Check browser storage and the API connection, then retry."));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "codes" && recoveryCodes) {
    return (
      <div className="auth-step">
        <RecoveryCodes
          codes={recoveryCodes}
          archiveRecoveryCode={archiveRecoveryCode}
          error={error}
          vaultReady={vaultReady}
          celebrate
          submitting={submitting}
          onContinue={continueToInbox}
        />
      </div>
    );
  }

  if (step === "enroll" && setup) {
    return (
      <div className="auth-step">
        <StepHeader
          eyebrow="Authenticator"
          title="Add your authenticator."
          description="Scan the key, then enter the current six-digit code. This finishes account setup."
        />
        <TotpEnrollment
          setup={setup}
          error={error}
          submitting={submitting}
          onConfirm={confirmAuthenticatorCode}
        />
      </div>
    );
  }

  if (step === "password") {
    return (
      <form
        className="auth-step space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!passwordReady || submitting) return;
          setError(null);
          if (!cryptoSupported()) {
            setError("This browser does not support the Web Crypto APIs required for E2EE.");
            return;
          }
          const failure = passwordPolicyFailure(password, email);
          if (failure || password !== passwordConfirm) return;
          setSubmitting(true);
          void api.register({
            username: username.trim(),
            displayName: displayName.trim(),
            email: email.trim(),
            password,
            passwordConfirm,
          }).then(
            (totpSetup) => {
              setSetup(totpSetup);
              setStep("enroll");
            },
            (err: unknown) => {
              setError(err instanceof ApiError ? err.message : "Could not create this account. Check that the API is available.");
            },
          ).finally(() => setSubmitting(false));
        }}
      >
        <StepHeader
          eyebrow="Step 3 of 3"
          title="Choose a password."
          description="These rules are checked as you type and again by the API."
        />
        <TextField
          id="signup-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        <TextField
          id="passwordConfirm"
          label="Repeat password"
          type="password"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={setPasswordConfirm}
        />
        <PasswordRules
          password={password}
          email={email}
          confirmed={password.length > 0 && password === passwordConfirm}
        />
        <FormError message={error} />
        <button type="submit" className={primaryButton} disabled={!passwordReady || submitting}>
          {submitting ? "Working…" : "Continue to authenticator"}
        </button>
        <button type="button" className={secondaryButton} onClick={() => setStep("email")}>
          Back
        </button>
      </form>
    );
  }

  if (step === "email") {
    return (
      <form
        className="auth-step space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = z.string().trim().email().safeParse(email);
          if (!parsed.success) {
            setEmailError("Enter a valid email.");
            return;
          }
          setEmail(parsed.data);
          setEmailError(null);
          setStep("password");
        }}
      >
        <StepHeader
          eyebrow="Step 2 of 3"
          title="Your email."
          description="Used for sign-in and password reset. The part before @ cannot appear in your password."
        />
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          error={emailError ?? undefined}
          onChange={(value) => {
            setEmail(value);
            setEmailError(null);
          }}
        />
        <button type="submit" className={primaryButton}>Continue</button>
        <button type="button" className={secondaryButton} onClick={() => setStep("profile")}>Back</button>
      </form>
    );
  }

  return (
    <form
      className="auth-step space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const name = displayName.trim();
        const handle = username.trim();
        if (!/^[a-zA-Z0-9_]{3,24}$/.test(handle)) {
          setProfileError("Use 3–24 letters, numbers, or underscores.");
          return;
        }
        if (name.length < 1 || name.length > 80) {
          setProfileError("Enter a display name.");
          return;
        }
        setUsername(handle);
        setDisplayName(name);
        setProfileError(null);
        setStep("email");
      }}
    >
      <StepHeader
        eyebrow="Step 1 of 3"
        title="Create your account."
        description="Sophia lives in the messenger. Start with the name people will see."
      />
      <TextField
        id="username"
        label="Username"
        autoComplete="username"
        value={username}
        onChange={(value) => {
          setUsername(value);
          setProfileError(null);
        }}
      />
      <TextField
        id="displayName"
        label="Display name"
        autoComplete="name"
        value={displayName}
        onChange={(value) => {
          setDisplayName(value);
          setProfileError(null);
        }}
      />
      <FormError message={profileError} />
      <button type="submit" className={primaryButton}>Continue</button>
    </form>
  );
}

function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<"credentials" | "totp" | "enroll" | "drive" | "codes">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [archiveRecoveryCode, setArchiveRecoveryCode] = useState<string | null>(null);
  const [historyRecoveryCode, setHistoryRecoveryCode] = useState("");
  const [mfaReason, setMfaReason] = useState<"new_browser" | "network_changed" | null>(null);
  const [trustBrowser, setTrustBrowser] = useState(false);
  const [factorMode, setFactorMode] = useState<"app" | "backup">("app");
  const [factorCode, setFactorCode] = useState("");
  const [archiveLocked, setArchiveLocked] = useState(false);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [driveReady, setDriveReady] = useState(false);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const driveConfigured = isGoogleDriveArchiveConfigured();

  useEffect(() => {
    if (step !== "drive" || !driveConfigured) return;
    let active = true;
    void loadGoogleIdentityServices().then(
      () => {
        if (active) setDriveReady(true);
      },
      (loadError: unknown) => {
        if (!active) return;
        setDriveError(loadError instanceof Error ? loadError.message : "Could not load Google sign-in.");
      },
    );
    return () => {
      active = false;
    };
  }, [driveConfigured, step]);

  async function readKnownDevice() {
    const account = await api.me();
    const [vault, deviceId] = await Promise.all([
      loadVault(account.user.id),
      loadDeviceId(account.user.id),
    ]);
    return isKnownLocalDevice({
      hasVault: Boolean(vault),
      vaultVersion: vault?.version,
      accountVaultVersion: account.user.vaultVersion,
      deviceId,
      accountDeviceIds: account.devices.map((device) => device.id),
    });
  }

  async function restoreDriveMaterial(code: string | undefined) {
    if (!driveAccessToken) return undefined;
    if (!code) {
      throw new Error("Enter the recovery code before using the Google Drive backup.");
    }
    const account = await api.me();
    const backup = await downloadGoogleDriveArchiveBackup(driveAccessToken);
    return decryptAccountArchiveDriveBackup(backup, account.user.id, code);
  }

  async function openDevice(recoveryCode?: string) {
    let restoredArchiveMaterial;
    try {
      restoredArchiveMaterial = await restoreDriveMaterial(recoveryCode);
      return await bootstrapDevice(password, recoveryCode, restoredArchiveMaterial);
    } catch (vaultError) {
      if (isArchiveError(vaultError)) throw vaultError;
      await lockDevice();
      try {
        await api.logout();
      } catch (logoutError) {
        const detail = logoutError instanceof Error ? logoutError.message : "server sign-out failed";
        throw new Error(`Could not open the local vault; ${detail}.`, { cause: vaultError });
      }
      throw vaultError;
    }
  }

  function rememberHistory(device: { historyUnavailable: boolean }) {
    if (device.historyUnavailable) {
      window.sessionStorage.setItem("private-messenger-history-recovery-unavailable", "true");
    } else {
      window.sessionStorage.removeItem("private-messenger-history-recovery-unavailable");
    }
  }

  async function finishDevice(recoveryCode?: string, pendingCodes?: string[] | null) {
    const codesToSave = pendingCodes ?? recoveryCodes;
    try {
      const device = await openDevice(recoveryCode);
      rememberHistory(device);
      if (device.archiveRecoveryCode || (codesToSave && codesToSave.length > 0)) {
        setArchiveRecoveryCode(device.archiveRecoveryCode ?? null);
        setRecoveryCodes(codesToSave ?? []);
        setVaultReady(true);
        setStep("codes");
        return;
      }
      setVaultReady(true);
      router.replace("/inbox");
    } catch (err) {
      if (isArchiveError(err)) {
        setArchiveLocked(true);
        setStep("drive");
        setError(messageFrom(err, "Enter the Google Drive recovery code."));
        return;
      }
      setStep("credentials");
      setError(messageFrom(err, "Could not unlock this device. Check your password and local browser storage."));
    }
  }

  async function continueAfterSession(trusted: boolean) {
    try {
      const known = await readKnownDevice();
      if (shouldAskForDriveRecovery({ trusted, known })) {
        setArchiveLocked(false);
        setStep("drive");
        return;
      }
      await finishDevice();
    } catch (err) {
      setError(messageFrom(err, "Could not check this device."));
    }
  }

  async function connectGoogleDrive() {
    if (!historyRecoveryCode.trim()) {
      setDriveError("Enter your recovery code before connecting Google Drive.");
      return;
    }
    setDriveError(null);
    setDriveConnecting(true);
    try {
      const token = await requestGoogleDriveAccessToken();
      setDriveAccessToken(token);
    } catch (connectError) {
      setDriveError(connectError instanceof Error ? connectError.message : "Could not authorize Google Drive access.");
    } finally {
      setDriveConnecting(false);
    }
  }

  async function leaveDeviceStep() {
    setSubmitting(true);
    try {
      await lockDevice();
      await api.logout();
    } catch {
      // The session cookie may already be gone. Return to the password step either way.
    } finally {
      setPassword("");
      setFactorCode("");
      setHistoryRecoveryCode("");
      setDriveAccessToken(null);
      setArchiveLocked(false);
      setError(null);
      setStep("credentials");
      setSubmitting(false);
    }
  }

  async function continueToInbox() {
    setError(null);
    setSubmitting(true);
    try {
      if (!vaultReady) {
        const device = await bootstrapDevice(password, historyRecoveryCode.trim() || undefined);
        rememberHistory(device);
        if (device.archiveRecoveryCode) {
          setArchiveRecoveryCode(device.archiveRecoveryCode);
          setRecoveryCodes((current) => current ?? []);
          setVaultReady(true);
          return;
        }
        setVaultReady(true);
      }
      if (archiveRecoveryCode) await acknowledgeArchiveRecoveryCode();
      router.replace("/inbox");
    } catch (err) {
      setError(messageFrom(err, "Secure device setup failed. Check browser storage and the API connection, then retry."));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "codes" && recoveryCodes) {
    return (
      <div className="auth-step">
        <RecoveryCodes
          codes={recoveryCodes}
          archiveRecoveryCode={archiveRecoveryCode}
          error={error}
          vaultReady={vaultReady}
          submitting={submitting}
          onContinue={continueToInbox}
        />
      </div>
    );
  }

  if (step === "drive") {
    const codeReady = historyRecoveryCode.trim().length > 0;
    return (
      <form
        className="auth-step space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (submitting) return;
          if (archiveLocked && !codeReady) return;
          setError(null);
          setSubmitting(true);
          void finishDevice(historyRecoveryCode.trim() || undefined).finally(() => setSubmitting(false));
        }}
      >
        <StepHeader
          eyebrow="This device"
          title="Restore from Google Drive."
          description={archiveLocked
            ? "Your password cannot open encrypted history here. Enter the recovery code for the Google Drive backup. It is not part of the password or authenticator step."
            : "This device is not already trusted. Enter the recovery code for the Google Drive backup if you have one. The code stays on this device."}
        />
        <TextField
          id="history-recovery-code"
          label="Google Drive recovery code"
          autoComplete="off"
          value={historyRecoveryCode}
          onChange={setHistoryRecoveryCode}
        />
        <p className="text-xs leading-5 text-(--muted)">
          The code decrypts the backup locally. Google Drive does not receive it.
        </p>
        {driveConfigured ? (
          <button
            type="button"
            className={secondaryButton}
            disabled={!driveReady || driveConnecting || !codeReady}
            onClick={() => void connectGoogleDrive()}
          >
            {driveConnecting
              ? "Connecting…"
              : driveAccessToken
                ? "Google Drive connected"
                : driveReady
                  ? "Connect Google Drive"
                  : "Loading Google sign-in…"}
          </button>
        ) : (
          <p className="text-xs leading-5 text-(--muted)">
            Google Drive is not configured in this build. The same recovery code can still unlock history stored with the account.
          </p>
        )}
        <FormError message={driveError} />
        <FormError message={error} />
        <button
          type="submit"
          className={primaryButton}
          disabled={submitting || (archiveLocked && !codeReady)}
        >
          {submitting ? "Working…" : "Continue"}
        </button>
        <button type="button" className={secondaryButton} disabled={submitting} onClick={() => void leaveDeviceStep()}>
          Sign out
        </button>
      </form>
    );
  }

  if (step === "enroll" && setup) {
    return (
      <div className="auth-step">
        <StepHeader
          eyebrow="Authenticator"
          title="Finish authenticator setup."
          description="This account does not have MFA yet. Add an authenticator and enter its six-digit code."
        />
        <TotpEnrollment
          setup={setup}
          error={error}
          submitting={submitting}
          onConfirm={async (code, trust) => {
            setError(null);
            setSubmitting(true);
            try {
              const result = await api.confirmTotp({
                setupToken: setup.setupToken,
                code,
                trustBrowser: trust,
              });
              setRecoveryCodes(result.recoveryCodes);
              await finishDevice(undefined, result.recoveryCodes);
              setSetup(null);
            } catch (err) {
              setError(messageFrom(err, "Could not finish authenticator or secure device setup."));
            } finally {
              setSubmitting(false);
            }
          }}
        />
      </div>
    );
  }

  if (step === "totp") {
    const appCode = /^\d{6}$/.test(factorCode);
    const backupCode = factorCode.trim().length >= 8;
    const factorReady = factorMode === "app" ? appCode : backupCode;
    return (
      <form
        className="auth-step space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!factorReady || submitting) return;
          setError(null);
          setSubmitting(true);
          void api.login({
            email,
            password,
            code: factorCode.trim(),
            trustBrowser,
          }).then(async (result) => {
            if ("mfaRequired" in result) {
              setError("That authenticator code was not accepted.");
              return;
            }
            if (result.setupRequired) {
              setSetup(result);
              setStep("enroll");
              return;
            }
            await continueAfterSession(false);
          }, (err: unknown) => {
            setError(err instanceof ApiError ? err.message : "Could not verify that code.");
          }).finally(() => setSubmitting(false));
        }}
      >
        <StepHeader
          eyebrow="Authenticator"
          title={factorMode === "app" ? "Enter the 6-digit code." : "Enter a one-time backup code."}
          description={mfaReason === "network_changed"
            ? "Your network changed since this browser was trusted. Confirm it is you with the six-digit code."
            : "From your authenticator app. This step is only the six-digit code."}
        />
        <TextField
          id="code"
          label={factorMode === "app" ? "Six-digit code" : "One-time backup code"}
          autoComplete="one-time-code"
          inputMode={factorMode === "app" ? "numeric" : "text"}
          value={factorCode}
          onChange={(value) => {
            setFactorCode(factorMode === "app" ? value.replace(/\D/g, "").slice(0, 6) : value);
          }}
        />
        <label className="flex items-start gap-3 text-sm text-(--muted)">
          <input
            type="checkbox"
            checked={trustBrowser}
            onChange={(event) => setTrustBrowser(event.target.checked)}
            className="mt-1 accent-(--accent)"
          />
          Trust this browser for 30 days, only on a device you control.
        </label>
        <button
          type="button"
          className="text-left text-sm text-(--muted) underline-offset-4 hover:text-(--foreground) hover:underline"
          onClick={() => {
            setFactorMode((mode) => mode === "app" ? "backup" : "app");
            setFactorCode("");
            setError(null);
          }}
        >
          {factorMode === "app"
            ? "Use a one-time backup code instead"
            : "Use the 6-digit authenticator code"}
        </button>
        <FormError message={error} />
        <button type="submit" className={primaryButton} disabled={!factorReady || submitting}>
          {submitting ? "Working…" : "Verify and continue"}
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            setFactorCode("");
            setError(null);
            setStep("credentials");
          }}
        >
          Back
        </button>
      </form>
    );
  }

  return (
    <form
      className="auth-step space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = credentialsSchema.safeParse({ email, password });
        if (!parsed.success) {
          setFieldError(parsed.error.issues[0]?.message ?? "Enter your email and password.");
          return;
        }
        if (!cryptoSupported()) {
          setFieldError("This browser does not support the Web Crypto APIs required for E2EE.");
          return;
        }
        setFieldError(null);
        setError(null);
        setSubmitting(true);
        setEmail(parsed.data.email);
        setPassword(parsed.data.password);
        void api.login({
          email: parsed.data.email,
          password: parsed.data.password,
        }).then(async (result) => {
          if ("mfaRequired" in result) {
            setMfaReason(result.reason);
            setFactorMode("app");
            setFactorCode("");
            setStep("totp");
            return;
          }
          if (result.setupRequired) {
            setSetup(result);
            setStep("enroll");
            return;
          }
          await continueAfterSession(true);
        }, (err: unknown) => {
          setError(err instanceof ApiError ? err.message : "Could not sign in. Check your email and password.");
        }).finally(() => setSubmitting(false));
      }}
    >
      <StepHeader
        eyebrow="Sign in"
        title="Email and password."
          description="The authenticator code is the next step, unless this browser is already trusted."
      />
      <TextField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        error={fieldError ?? undefined}
        onChange={(value) => {
          setEmail(value);
          setFieldError(null);
        }}
      />
      <TextField
        id="login-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />
      <div className="text-right text-sm">
        <Link href="/forgot-password" className="text-(--muted) hover:text-(--foreground)">
          Forgot password?
        </Link>
      </div>
      <FormError message={error} />
      <button type="submit" className={primaryButton} disabled={submitting}>
        {submitting ? "Working…" : "Continue"}
      </button>
    </form>
  );
}

function TotpEnrollment({
  setup,
  error,
  submitting,
  onConfirm,
}: {
  setup: TotpSetup;
  error: string | null;
  submitting: boolean;
  onConfirm: (code: string, trustBrowser: boolean) => Promise<void>;
}) {
  const [trustBrowser, setTrustBrowser] = useState(false);
  const [code, setCode] = useState("");
  const ready = /^\d{6}$/.test(code);

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || submitting) return;
        void onConfirm(code, trustBrowser);
      }}
    >
      <div className="rounded-xl border border-(--line) bg-(--control-bg) p-4 text-center">
        <p className="text-sm font-medium text-(--foreground)">Scan with your authenticator app</p>
        <div className="mx-auto mt-3 w-fit rounded-lg bg-white p-3">
          <QRCodeSVG value={setup.otpauthUrl} size={196} level="M" title="Authenticator setup QR code" />
        </div>
        <p className="mt-3 text-xs text-(--muted)">The QR code contains your secret setup key. Keep it private.</p>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium tracking-[0.14em] text-(--muted) uppercase">Manual setup key</p>
        <code className="block break-all text-sm tracking-wider text-(--foreground)">{setup.secret}</code>
        <a href={setup.otpauthUrl} className="inline-block text-xs text-(--foreground) underline underline-offset-4">
          Open authenticator app
        </a>
      </div>
      <TextField
        id="totp-confirm-code"
        label="Six-digit code"
        autoComplete="one-time-code"
        inputMode="numeric"
        value={code}
        error={code.length > 0 && !ready ? "Enter the current six-digit authenticator code." : undefined}
        onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
      />
      <label className="flex items-start gap-3 text-sm text-(--muted)">
        <input
          type="checkbox"
          checked={trustBrowser}
          onChange={(event) => setTrustBrowser(event.target.checked)}
          className="mt-1 accent-(--accent)"
        />
        Trust this browser for 30 days, only on a device you control.
      </label>
      <FormError message={error} />
      <button type="submit" className={primaryButton} disabled={!ready || submitting}>
        {submitting ? "Verifying…" : "Verify and enable MFA"}
      </button>
    </form>
  );
}

function RecoveryCodes({
  codes,
  archiveRecoveryCode,
  error,
  vaultReady,
  celebrate = false,
  submitting,
  onContinue,
}: {
  codes: string[];
  archiveRecoveryCode: string | null;
  error: string | null;
  vaultReady: boolean;
  celebrate?: boolean;
  submitting: boolean;
  onContinue: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [recoveryCodeSaved, setRecoveryCodeSaved] = useState(false);

  async function copyCodes() {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText([
        ...(codes.length ? ["Authenticator recovery codes:", ...codes] : []),
        ...(archiveRecoveryCode ? ["Message history recovery code:", archiveRecoveryCode] : []),
      ].join("\n"));
      setCopied(true);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="space-y-5">
      <StepHeader
        eyebrow={celebrate ? "Ready" : "Save these"}
        title={celebrate
          ? "Your account is ready."
          : codes.length
            ? "Save your recovery codes."
            : "Save your history recovery code."}
        description={codes.length
          ? "Each authenticator backup code works once if you cannot access your authenticator. The history code unlocks older messages after a password reset."
          : "Save the history recovery code somewhere private before continuing. It is shown only now."}
      />
      {codes.length ? (
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-(--line) bg-(--control-bg) p-4 font-mono text-sm text-(--foreground) sm:grid-cols-2">
          {codes.map((code) => <span key={code}>{code}</span>)}
        </div>
      ) : null}
      {archiveRecoveryCode ? (
        <div className="rounded-xl border border-(--line) bg-(--control-bg) p-4">
          <p className="mb-2 text-xs text-(--muted)">Message history recovery code</p>
          <code className="block break-all font-mono text-sm text-(--foreground)">{archiveRecoveryCode}</code>
        </div>
      ) : null}
      {archiveRecoveryCode ? (
        <label className="flex items-start gap-3 text-sm text-(--muted)">
          <input
            type="checkbox"
            checked={recoveryCodeSaved}
            onChange={(event) => setRecoveryCodeSaved(event.target.checked)}
            className="mt-1 accent-(--accent)"
          />
          I saved this history recovery code somewhere private.
        </label>
      ) : null}
      <button type="button" className={secondaryButton} onClick={() => void copyCodes()}>
        {copied ? "Copied" : "Copy recovery information"}
      </button>
      {copyError ? <p className="text-sm text-(--danger)">Clipboard access is unavailable. Copy the codes manually.</p> : null}
      <FormError message={error} />
      <button
        type="button"
        className={primaryButton}
        disabled={submitting || Boolean(archiveRecoveryCode && !recoveryCodeSaved)}
        onClick={() => void onContinue()}
      >
        {vaultReady ? "Continue to inbox" : "Finish secure device setup"}
      </button>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  return (
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async ({ email }) => {
        setError(null);
        setMessage(null);
        try {
          const result = await api.requestPasswordReset(email);
          setMessage(result.message);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not request password recovery. Try again later.");
        }
      })}
    >
      <Field
        id="recovery-email"
        label="Account email"
        type="email"
        autoComplete="email"
        registration={form.register("email")}
        error={form.formState.errors.email?.message}
      />
      {message ? (
        <p role="status" className="rounded-xl border border-(--line) bg-(--control-bg) p-3 text-sm text-(--foreground)">
          {message}
        </p>
      ) : null}
      <FormError message={error} />
      <button type="submit" className={primaryButton} disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      token,
      password: "",
      passwordConfirm: "",
      code: "",
    },
  });
  const password = form.watch("password");
  const passwordConfirm = form.watch("passwordConfirm");
  const ready = passwordIsReady(password, passwordConfirm);

  if (complete) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-(--foreground)">Password reset. Sign in and create a new device vault.</p>
        <p className="text-sm text-(--muted)">
          Old device keys are not restored. Use your saved history recovery code when this device asks for the Google Drive backup.
        </p>
        <Link href="/login" className="inline-block text-sm font-medium text-(--foreground) underline underline-offset-4">
          Continue to login
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        if (!passwordIsReady(values.password, values.passwordConfirm)) return;
        try {
          await api.resetPassword(values);
          setComplete(true);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not reset the password. The link may have expired.");
        }
      })}
    >
      <input type="hidden" {...form.register("token")} />
      <Field
        id="reset-password"
        label="New password"
        type="password"
        autoComplete="new-password"
        registration={form.register("password")}
        error={form.formState.errors.password?.message}
      />
      <Field
        id="reset-password-confirm"
        label="Repeat new password"
        type="password"
        autoComplete="new-password"
        registration={form.register("passwordConfirm")}
        error={form.formState.errors.passwordConfirm?.message}
      />
      <PasswordRules password={password} confirmed={password.length > 0 && password === passwordConfirm} />
      <p className="text-xs leading-5 text-(--muted)">
        The new password also cannot contain your email name. A valid authenticator or unused backup code is required.
      </p>
      <Field
        id="reset-code"
        label="Authenticator or backup code"
        autoComplete="one-time-code"
        inputMode="text"
        registration={form.register("code")}
        error={form.formState.errors.code?.message}
      />
      <FormError message={error} />
      <button type="submit" className={primaryButton} disabled={!token || !ready || form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}

function StepHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header>
      <p className="text-xs font-medium tracking-[0.16em] text-(--muted) uppercase">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-(--foreground)">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-(--muted)">{description}</p>
    </header>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="text-sm text-(--danger)">{message}</p>;
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "email";
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs font-medium tracking-[0.14em] text-(--muted) uppercase">
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={controlClass}
      />
      {error ? <p role="alert" className="mt-2 text-xs text-(--danger)">{error}</p> : null}
    </div>
  );
}

function Field({
  id,
  label,
  registration,
  type = "text",
  autoComplete,
  inputMode,
  error,
}: {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  type?: string;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "email";
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs font-medium tracking-[0.14em] text-(--muted) uppercase">
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className={controlClass}
        {...registration}
      />
      {error ? <p role="alert" className="mt-2 text-xs text-(--danger)">{error}</p> : null}
    </div>
  );
}

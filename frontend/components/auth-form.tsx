"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { PasswordRules } from "@/components/password-rules";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";
import { logAccountActivity } from "@/lib/account-activity";
import { ApiError, api, type TotpSetup } from "@/lib/api";
import {
  CLOUD_SOPHIA_CONSENT_VERSION,
  CLOUD_SOPHIA_PURPOSE,
  signupCloudConsentBody,
} from "@/lib/cloud-sophia";
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

function messageFrom(
  error: unknown,
  fallback: string,
  t?: (key: MessageKey) => string,
) {
  if (error instanceof Error && error.message === "ARCHIVE_RECOVERY_CODE_REQUIRED") {
    return t ? t("auth.archiveRequired") : "Enter the Google Drive recovery code to unlock encrypted history on this device.";
  }
  if (error instanceof Error && error.message === "INVALID_ARCHIVE_RECOVERY_CODE") {
    return t ? t("auth.archiveInvalid") : "That recovery code is not valid. Check it and try again.";
  }
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const { t } = useI18n();
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
    return <p role="status" className="text-sm text-(--muted)">{t("auth.checking")}</p>;
  }

  if (sessionCheckError) {
    return (
      <div className="space-y-4 text-center">
        <p role="alert" className="text-sm text-(--danger)">
          {t("auth.sessionFailed")} {sessionCheckError}
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
          {t("auth.retrySession")}
        </button>
      </div>
    );
  }

  return mode === "signup" ? <SignupForm /> : <LoginForm />;
}

function SignupForm() {
  const router = useRouter();
  const { t } = useI18n();
  const [step, setStep] = useState<"profile" | "email" | "password" | "consent" | "enroll" | "codes">("profile");
  const [cloudConsent, setCloudConsent] = useState(false);
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
      if (cloudConsent) {
        logAccountActivity({
          action: "SETTING_CHANGED",
          summary: "Saved cloud Sophia consent at signup",
          subjectKind: "consent",
          subjectId: CLOUD_SOPHIA_CONSENT_VERSION,
        });
      }
      setRecoveryCodes(result.recoveryCodes);
      setArchiveRecoveryCode(device.archiveRecoveryCode ?? null);
      setVaultReady(true);
      setSetup(null);
      setStep("codes");
    } catch (err) {
      setError(messageFrom(err, t("auth.deviceSetupFailed"), t));
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
      setError(messageFrom(err, t("auth.deviceSetupAfterMfa"), t));
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
          eyebrow={t("auth.authenticator")}
          title={t("auth.addAuthenticator")}
          description={t("auth.addAuthenticatorBody")}
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

  if (step === "consent") {
    return (
      <form
        className="auth-step space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!passwordReady || submitting) return;
          setError(null);
          if (!cryptoSupported()) {
            setError(t("auth.cryptoUnsupported"));
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
            ...signupCloudConsentBody(cloudConsent),
          }).then(
            (totpSetup) => {
              setSetup(totpSetup);
              setStep("enroll");
            },
            (err: unknown) => {
              setError(err instanceof ApiError ? err.message : t("auth.createFailed"));
            },
          ).finally(() => setSubmitting(false));
        }}
      >
        <StepHeader
          eyebrow={t("auth.stepOf", { step: 4, total: 4 })}
          title={t("auth.cloudTitle")}
          description={t("auth.cloudBody")}
        />
        <blockquote className="rounded-xl border border-(--line) bg-(--control-bg) p-4 text-sm leading-relaxed text-(--foreground)">
          {CLOUD_SOPHIA_PURPOSE}
        </blockquote>
        <p className="text-xs text-(--muted)">
          {t("auth.cloudVersion", { version: CLOUD_SOPHIA_CONSENT_VERSION })}
        </p>
        <label className="flex items-start gap-3 text-sm text-(--muted)">
          <input
            type="checkbox"
            checked={cloudConsent}
            onChange={(event) => setCloudConsent(event.target.checked)}
            className="mt-1 accent-(--accent)"
          />
          {t("auth.cloudAgree")}
        </label>
        <FormError message={error} />
        <button type="submit" className={primaryButton} disabled={!passwordReady || submitting}>
          {submitting ? t("auth.working") : t("auth.continueAuthenticator")}
        </button>
        <button type="button" className={secondaryButton} onClick={() => setStep("password")}>
          {t("auth.back")}
        </button>
      </form>
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
            setError(t("auth.cryptoUnsupported"));
            return;
          }
          const failure = passwordPolicyFailure(password, email);
          if (failure || password !== passwordConfirm) return;
          setStep("consent");
        }}
      >
        <StepHeader
          eyebrow={t("auth.stepOf", { step: 3, total: 4 })}
          title={t("auth.passwordTitle")}
          description={t("auth.passwordBody")}
        />
        <TextField
          id="signup-password"
          label={t("auth.password")}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        <TextField
          id="passwordConfirm"
          label={t("auth.repeatPassword")}
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
          {t("auth.continue")}
        </button>
        <button type="button" className={secondaryButton} onClick={() => setStep("email")}>
          {t("auth.back")}
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
            setEmailError(t("auth.invalidEmail"));
            return;
          }
          setEmail(parsed.data);
          setEmailError(null);
          setStep("password");
        }}
      >
        <StepHeader
          eyebrow={t("auth.stepOf", { step: 2, total: 4 })}
          title={t("auth.emailTitle")}
          description={t("auth.emailBody")}
        />
        <TextField
          id="email"
          label={t("auth.email")}
          type="email"
          autoComplete="email"
          value={email}
          error={emailError ?? undefined}
          onChange={(value) => {
            setEmail(value);
            setEmailError(null);
          }}
        />
        <button type="submit" className={primaryButton}>{t("auth.continue")}</button>
        <button type="button" className={secondaryButton} onClick={() => setStep("profile")}>{t("auth.back")}</button>
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
          setProfileError(t("auth.usernameRule"));
          return;
        }
        if (name.length < 1 || name.length > 80) {
          setProfileError(t("auth.displayNameRule"));
          return;
        }
        setUsername(handle);
        setDisplayName(name);
        setProfileError(null);
        setStep("email");
      }}
    >
      <StepHeader
        eyebrow={t("auth.stepOf", { step: 1, total: 4 })}
        title={t("auth.createTitle")}
        description={t("auth.createBody")}
      />
      <TextField
        id="username"
        label={t("auth.username")}
        autoComplete="username"
        value={username}
        onChange={(value) => {
          setUsername(value);
          setProfileError(null);
        }}
      />
      <TextField
        id="displayName"
        label={t("auth.displayName")}
        autoComplete="name"
        value={displayName}
        onChange={(value) => {
          setDisplayName(value);
          setProfileError(null);
        }}
      />
      <FormError message={profileError} />
      <button type="submit" className={primaryButton}>{t("auth.continue")}</button>
    </form>
  );
}

function LoginForm() {
  const router = useRouter();
  const { t } = useI18n();
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
        setError(messageFrom(err, t("auth.driveCodePrompt"), t));
        return;
      }
      setStep("credentials");
      setError(messageFrom(err, t("auth.unlockFailed"), t));
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
      setError(messageFrom(err, t("auth.deviceCheckFailed"), t));
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
      setError(messageFrom(err, t("auth.resetDeviceFailed"), t));
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
          eyebrow={t("auth.thisDevice")}
          title={t("auth.driveTitle")}
          description={archiveLocked ? t("auth.driveLocked") : t("auth.driveOptional")}
        />
        <TextField
          id="history-recovery-code"
          label={t("auth.driveCode")}
          autoComplete="off"
          value={historyRecoveryCode}
          onChange={setHistoryRecoveryCode}
        />
        <p className="text-xs leading-5 text-(--muted)">
          {t("auth.driveLocal")}
        </p>
        {driveConfigured ? (
          <button
            type="button"
            className={secondaryButton}
            disabled={!driveReady || driveConnecting || !codeReady}
            onClick={() => void connectGoogleDrive()}
          >
            {driveConnecting
              ? t("auth.driveConnecting")
              : driveAccessToken
                ? t("auth.driveConnected")
                : driveReady
                  ? t("auth.driveConnect")
                  : t("auth.driveLoading")}
          </button>
        ) : (
          <p className="text-xs leading-5 text-(--muted)">
            {t("auth.driveMissing")}
          </p>
        )}
        <FormError message={driveError} />
        <FormError message={error} />
        <button
          type="submit"
          className={primaryButton}
          disabled={submitting || (archiveLocked && !codeReady)}
        >
          {submitting ? t("auth.working") : t("auth.continue")}
        </button>
        <button type="button" className={secondaryButton} disabled={submitting} onClick={() => void leaveDeviceStep()}>
          {t("auth.signOut")}
        </button>
      </form>
    );
  }

  if (step === "enroll" && setup) {
    return (
      <div className="auth-step">
        <StepHeader
          eyebrow={t("auth.authenticator")}
          title={t("auth.finishAuthenticator")}
          description={t("auth.finishAuthenticatorBody")}
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
              setError(messageFrom(err, t("auth.mfaFailed"), t));
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
          eyebrow={t("auth.authenticator")}
          title={factorMode === "app" ? t("auth.codeTitle") : t("auth.backupTitle")}
          description={mfaReason === "network_changed"
            ? t("auth.codeNetwork")
            : t("auth.codeBody")}
        />
        <TextField
          id="code"
          label={factorMode === "app" ? t("auth.sixDigit") : t("auth.backupCode")}
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
          {t("auth.trustBrowser")}
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
            ? t("auth.useBackup")
            : t("auth.useAppCode")}
        </button>
        <FormError message={error} />
        <button type="submit" className={primaryButton} disabled={!factorReady || submitting}>
          {submitting ? t("auth.working") : t("auth.verifyContinue")}
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
          {t("auth.back")}
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
          setFieldError(t("auth.enterBoth"));
          return;
        }
        if (!cryptoSupported()) {
          setFieldError(t("auth.cryptoUnsupported"));
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
          setError(err instanceof ApiError ? err.message : t("auth.signInFailed"));
        }).finally(() => setSubmitting(false));
      }}
    >
      <StepHeader
        eyebrow={t("auth.signIn")}
        title={t("auth.credentialsTitle")}
        description={t("auth.credentialsBody")}
      />
      <TextField
        id="email"
        label={t("auth.email")}
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
        label={t("auth.password")}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />
      <div className="text-end text-sm">
        <Link href="/forgot-password" className="text-(--muted) hover:text-(--foreground)">
          {t("auth.forgot")}
        </Link>
      </div>
      <FormError message={error} />
      <button type="submit" className={primaryButton} disabled={submitting}>
        {submitting ? t("auth.working") : t("auth.continue")}
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
  const { t } = useI18n();
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
        <p className="text-sm font-medium text-(--foreground)">{t("auth.scanQr")}</p>
        <div className="mx-auto mt-3 w-fit rounded-lg bg-white p-3">
          <QRCodeSVG value={setup.otpauthUrl} size={196} level="M" title={t("auth.qrTitle")} />
        </div>
        <p className="mt-3 text-xs text-(--muted)">{t("auth.qrPrivate")}</p>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-(--muted)">{t("auth.manualKey")}</p>
        <code className="block break-all text-sm tracking-wider text-(--foreground)">{setup.secret}</code>
        <a href={setup.otpauthUrl} className="inline-block text-xs text-(--foreground) underline underline-offset-4">
          {t("auth.openAuthenticator")}
        </a>
      </div>
      <TextField
        id="totp-confirm-code"
        label={t("auth.sixDigit")}
        autoComplete="one-time-code"
        inputMode="numeric"
        value={code}
        error={code.length > 0 && !ready ? t("auth.currentCode") : undefined}
        onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
      />
      <label className="flex items-start gap-3 text-sm text-(--muted)">
        <input
          type="checkbox"
          checked={trustBrowser}
          onChange={(event) => setTrustBrowser(event.target.checked)}
          className="mt-1 accent-(--accent)"
        />
        {t("auth.trustBrowser")}
      </label>
      <FormError message={error} />
      <button type="submit" className={primaryButton} disabled={!ready || submitting}>
        {submitting ? t("auth.verifying") : t("auth.enableMfa")}
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
  const { t } = useI18n();
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
        eyebrow={celebrate ? t("auth.ready") : t("auth.saveThese")}
        title={celebrate
          ? t("auth.accountReady")
          : codes.length
            ? t("auth.saveCodes")
            : t("auth.saveHistoryCode")}
        description={codes.length ? t("auth.codesBody") : t("auth.historyOnlyBody")}
      />
      {codes.length ? (
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-(--line) bg-(--control-bg) p-4 font-mono text-sm text-(--foreground) sm:grid-cols-2">
          {codes.map((code) => <span key={code}>{code}</span>)}
        </div>
      ) : null}
      {archiveRecoveryCode ? (
        <div className="rounded-xl border border-(--line) bg-(--control-bg) p-4">
          <p className="mb-2 text-xs text-(--muted)">{t("auth.historyCode")}</p>
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
          {t("auth.savedHistory")}
        </label>
      ) : null}
      <button type="button" className={secondaryButton} onClick={() => void copyCodes()}>
        {copied ? t("auth.copied") : t("auth.copyRecovery")}
      </button>
      {copyError ? <p className="text-sm text-(--danger)">{t("auth.clipboardFailed")}</p> : null}
      <FormError message={error} />
      <button
        type="button"
        className={primaryButton}
        disabled={submitting || Boolean(archiveRecoveryCode && !recoveryCodeSaved)}
        onClick={() => void onContinue()}
      >
        {vaultReady ? t("auth.continueInbox") : t("auth.finishDevice")}
      </button>
    </div>
  );
}

export function ForgotPasswordForm() {
  const { t } = useI18n();
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
          setError(err instanceof ApiError ? err.message : t("auth.resetRequestFailed"));
        }
      })}
    >
      <Field
        id="recovery-email"
        label={t("auth.accountEmail")}
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
        {form.formState.isSubmitting ? t("auth.sending") : t("auth.sendReset")}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useI18n();
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
        <p className="text-sm text-(--foreground)">{t("auth.resetDone")}</p>
        <p className="text-sm text-(--muted)">{t("auth.resetDoneBody")}</p>
        <Link href="/login" className="inline-block text-sm font-medium text-(--foreground) underline underline-offset-4">
          {t("auth.continueLogin")}
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
          setError(err instanceof ApiError ? err.message : t("auth.resetFailed"));
        }
      })}
    >
      <input type="hidden" {...form.register("token")} />
      <Field
        id="reset-password"
        label={t("auth.newPassword")}
        type="password"
        autoComplete="new-password"
        registration={form.register("password")}
        error={form.formState.errors.password?.message}
      />
      <Field
        id="reset-password-confirm"
        label={t("auth.repeatNewPassword")}
        type="password"
        autoComplete="new-password"
        registration={form.register("passwordConfirm")}
        error={form.formState.errors.passwordConfirm?.message}
      />
      <PasswordRules password={password} confirmed={password.length > 0 && password === passwordConfirm} />
      <p className="text-xs leading-5 text-(--muted)">
        {t("auth.resetHint")}
      </p>
      <Field
        id="reset-code"
        label={t("auth.resetCode")}
        autoComplete="one-time-code"
        inputMode="text"
        registration={form.register("code")}
        error={form.formState.errors.code?.message}
      />
      <FormError message={error} />
      <button type="submit" className={primaryButton} disabled={!token || !ready || form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("auth.resetting") : t("auth.resetPassword")}
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
        dir={type === "email" || type === "password" || inputMode === "numeric" ? "ltr" : "auto"}
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
        dir={type === "email" || type === "password" || inputMode === "numeric" ? "ltr" : "auto"}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className={controlClass}
        {...registration}
      />
      {error ? <p role="alert" className="mt-2 text-xs text-(--danger)">{error}</p> : null}
    </div>
  );
}

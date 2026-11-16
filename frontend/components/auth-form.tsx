"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api, type TotpSetup } from "@/lib/api";
import { decryptAccountArchiveDriveBackup } from "@/lib/crypto/account-archive";
import {
  downloadGoogleDriveArchiveBackup,
  isGoogleDriveArchiveConfigured,
  loadGoogleIdentityServices,
  requestGoogleDriveAccessToken,
} from "@/lib/google-drive-archive";
import {
  acknowledgeArchiveRecoveryCode,
  bootstrapDevice,
  cryptoSupported,
  lockDevice,
} from "@/lib/session";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/validators";

function AnimatedAuthStage({
  stage,
  children,
}: {
  stage: string;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      key={stage}
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
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
    return (
      <AnimatedAuthStage stage="checking-session">
        <p role="status" className="text-center text-sm text-white/45">Checking your session…</p>
      </AnimatedAuthStage>
    );
  }

  if (sessionCheckError) {
    return (
      <AnimatedAuthStage stage="session-error">
      <div className="space-y-4 text-center">
        <p role="alert" className="text-sm text-red-300">
          Could not verify your current session. {sessionCheckError}
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            setCheckingSession(true);
            setSessionCheckError(null);
            setSessionCheckAttempt((attempt) => attempt + 1);
          }}
        >
          Retry session check
        </Button>
      </div>
      </AnimatedAuthStage>
    );
  }

  return mode === "signup" ? <SignupForm /> : <LoginForm />;
}

function SignupForm() {
  const router = useRouter();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [passwordForVault, setPasswordForVault] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [archiveRecoveryCode, setArchiveRecoveryCode] = useState<string | null>(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      username: "",
      displayName: "",
      email: "",
      password: "",
      passwordConfirm: "",
    },
  });

  async function confirmAuthenticatorCode(code: string, trustBrowser: boolean) {
    if (!setup) return;
    setError(null);

    try {
      const result = await api.confirmTotp({
        setupToken: setup.setupToken,
        code,
        trustBrowser,
      });
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      const device = await bootstrapDevice(passwordForVault);
      setArchiveRecoveryCode(device.archiveRecoveryCode ?? null);
      setVaultReady(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not finish secure device setup: ${err.message}`
          : "Could not finish secure device setup for an unknown reason. Retry and check browser storage and the API connection.",
      );
    }
  }

  async function continueToInbox() {
    setError(null);
    try {
      if (!vaultReady) {
        const device = await bootstrapDevice(passwordForVault);
        if (device.archiveRecoveryCode) {
          setArchiveRecoveryCode(device.archiveRecoveryCode);
          setRecoveryCodes([]);
          return;
        }
        setVaultReady(true);
      }
      if (archiveRecoveryCode) await acknowledgeArchiveRecoveryCode();
      router.replace("/inbox");
    } catch (err) {
      setError(
        err instanceof Error
          ? `Authenticator setup is complete, but secure device setup failed: ${err.message}`
          : "Authenticator setup is complete, but secure device setup failed for an unknown reason. Check browser storage and the API connection, then retry.",
      );
    }
  }

  if (recoveryCodes) {
    return (
      <AnimatedAuthStage stage="signup-recovery">
        <RecoveryCodes
          codes={recoveryCodes}
          archiveRecoveryCode={archiveRecoveryCode}
          error={error}
          vaultReady={vaultReady}
          celebrate
          onContinue={continueToInbox}
        />
      </AnimatedAuthStage>
    );
  }

  if (setup) {
    return (
      <AnimatedAuthStage stage="signup-authenticator">
        <TotpEnrollment
          setup={setup}
          error={error}
          onConfirm={confirmAuthenticatorCode}
        />
      </AnimatedAuthStage>
    );
  }

  return (
    <AnimatedAuthStage stage="signup-form">
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        if (!cryptoSupported()) {
          setError("This browser does not support the Web Crypto APIs required for E2EE.");
          return;
        }
        try {
          const totpSetup = await api.register(values);
          setPasswordForVault(values.password);
          setSetup(totpSetup);
        } catch (err) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not create this account. Check that the API is available.",
          );
        }
      })}
    >
      <Field
        id="username"
        label="Username"
        autoComplete="username"
        registration={form.register("username")}
        error={form.formState.errors.username?.message}
      />
      <Field
        id="displayName"
        label="Display name"
        registration={form.register("displayName")}
        error={form.formState.errors.displayName?.message}
      />
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        registration={form.register("email")}
        error={form.formState.errors.email?.message}
      />
      <PasswordField
        id="signup-password"
        label="Password"
        registration={form.register("password")}
        autoComplete="new-password"
        error={form.formState.errors.password?.message}
      />
      <PasswordField
        id="passwordConfirm"
        label="Repeat password"
        registration={form.register("passwordConfirm")}
        autoComplete="new-password"
        error={form.formState.errors.passwordConfirm?.message}
      />
      <p className="-mt-3 text-xs text-white/35">
        Use at least 12 characters and save the separate history recovery code shown after setup.
        That code restores archived messages after a password reset, but not another device&apos;s
        live ratchet keys.
      </p>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="signup-error"
            role="alert"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            className="overflow-hidden text-sm text-red-300"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Working…" : "Continue to authenticator setup"}
      </Button>
    </form>
    </AnimatedAuthStage>
  );
}

function LoginForm() {
  const router = useRouter();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [passwordForVault, setPasswordForVault] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [archiveRecoveryCode, setArchiveRecoveryCode] = useState<string | null>(null);
  const [historyRecoveryCode, setHistoryRecoveryCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaReason, setMfaReason] = useState<"new_browser" | "network_changed" | null>(null);
  const [trustBrowser, setTrustBrowser] = useState(false);
  const [restoreFromDrive, setRestoreFromDrive] = useState(false);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [driveReady, setDriveReady] = useState(false);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [vaultReady, setVaultReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const driveConfigured = isGoogleDriveArchiveConfigured();
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", code: "" },
  });

  useEffect(() => {
    if (!driveConfigured) return;
    void loadGoogleIdentityServices().then(
      () => setDriveReady(true),
      (loadError: unknown) => {
        setDriveError(
          loadError instanceof Error ? loadError.message : "Could not load Google sign-in.",
        );
      },
    );
  }, [driveConfigured]);

  async function connectGoogleDrive() {
    if (!historyRecoveryCode.trim()) {
      setDriveError("Enter your history recovery code before connecting Google Drive.");
      return;
    }
    setDriveError(null);
    setDriveConnecting(true);
    try {
      const token = await requestGoogleDriveAccessToken();
      setDriveAccessToken(token);
      setDriveError(null);
    } catch (connectError) {
      setDriveError(
        connectError instanceof Error
          ? connectError.message
          : "Could not authorize Google Drive access.",
      );
    } finally {
      setDriveConnecting(false);
    }
  }

  async function restoreArchiveMaterial(userId: string) {
    if (!restoreFromDrive) return undefined;
    if (!driveAccessToken) {
      throw new Error("Connect Google Drive before continuing with archive recovery.");
    }
    if (!historyRecoveryCode.trim()) {
      throw new Error("Enter your history recovery code to decrypt the Drive backup.");
    }
    const backup = await downloadGoogleDriveArchiveBackup(driveAccessToken);
    return decryptAccountArchiveDriveBackup(
      backup,
      userId,
      historyRecoveryCode,
    );
  }

  async function bootstrapAuthenticatedDevice(userId: string, password: string) {
    let restoredArchiveMaterial;
    try {
      restoredArchiveMaterial = await restoreArchiveMaterial(userId);
      return await bootstrapDevice(
        password,
        historyRecoveryCode || undefined,
        restoredArchiveMaterial,
      );
    } catch (vaultError) {
      await lockDevice();
      try {
        await api.logout();
      } catch (logoutError) {
        const detail = logoutError instanceof Error
          ? logoutError.message
          : "server sign-out failed";
        throw new Error(`Could not open the local vault; ${detail}.`, {
          cause: vaultError,
        });
      }
      throw vaultError;
    }
  }

  async function completeAuthenticatorSetup(code: string, trustBrowser: boolean) {
    if (!setup) return;
    setError(null);

    try {
      const result = await api.confirmTotp({
        setupToken: setup.setupToken,
        code,
        trustBrowser,
      });
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      const device = await bootstrapAuthenticatedDevice(
        result.user.id,
        passwordForVault,
      );
      setArchiveRecoveryCode(device.archiveRecoveryCode ?? null);
      setVaultReady(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not finish authenticator or secure device setup.",
      );
    }
  }

  async function continueToInbox() {
    setError(null);
    try {
      if (!vaultReady) {
        const device = await bootstrapDevice(passwordForVault, historyRecoveryCode || undefined);
        if (device.archiveRecoveryCode) {
          setArchiveRecoveryCode(device.archiveRecoveryCode);
          setRecoveryCodes([]);
          return;
        }
        setVaultReady(true);
      }
      if (archiveRecoveryCode) await acknowledgeArchiveRecoveryCode();
      router.replace("/inbox");
    } catch (err) {
      setError(
        err instanceof Error
          ? `Authenticator setup is complete, but secure device setup failed: ${err.message}`
          : "Authenticator setup is complete, but secure device setup failed for an unknown reason. Check browser storage and the API connection, then retry.",
      );
    }
  }

  if (recoveryCodes) {
    return (
      <AnimatedAuthStage stage="login-recovery">
        <RecoveryCodes
          codes={recoveryCodes}
          archiveRecoveryCode={archiveRecoveryCode}
          error={error}
          vaultReady={vaultReady}
          onContinue={continueToInbox}
        />
      </AnimatedAuthStage>
    );
  }

  if (setup) {
    return (
      <AnimatedAuthStage stage="login-authenticator">
        <TotpEnrollment
          setup={setup}
          error={error}
          onConfirm={completeAuthenticatorSetup}
        />
      </AnimatedAuthStage>
    );
  }

  return (
    <AnimatedAuthStage stage="login-form">
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        if (!cryptoSupported()) {
          setError("This browser does not support the Web Crypto APIs required for E2EE.");
          return;
        }
        try {
          const result = await api.login({
            email: values.email,
            password: values.password,
            code: values.code || undefined,
            trustBrowser: values.code ? trustBrowser : false,
          });
          if ("mfaRequired" in result) {
            setMfaRequired(true);
            setMfaReason(result.reason);
            setError(null);
            return;
          }
          setPasswordForVault(values.password);
          if (result.setupRequired) {
            setSetup(result);
            return;
          }
          try {
            const device = await bootstrapAuthenticatedDevice(
              result.user.id,
              values.password,
            );
            if (device.historyUnavailable) {
              window.sessionStorage.setItem(
                "private-messenger-history-recovery-unavailable",
                "true",
              );
            } else {
              window.sessionStorage.removeItem(
                "private-messenger-history-recovery-unavailable",
              );
            }
            if (device.archiveRecoveryCode) {
              setArchiveRecoveryCode(device.archiveRecoveryCode);
              setRecoveryCodes([]);
              return;
            }
          } catch (vaultError) {
            throw vaultError;
          }
          router.replace("/inbox");
        } catch (err) {
          if (err instanceof Error && err.message === "ARCHIVE_RECOVERY_CODE_REQUIRED") {
            setError(
              "Your account history is still protected by its previous password. Enter the history recovery code to unlock it on this device.",
            );
          } else if (err instanceof Error && err.message === "INVALID_ARCHIVE_RECOVERY_CODE") {
            setError("That message history recovery code is not valid. Check it and try again.");
          } else {
            setError(
              err instanceof ApiError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "Could not unlock this device. Check your password and local browser storage.",
            );
          }
        }
      })}
    >
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        registration={form.register("email")}
        error={form.formState.errors.email?.message}
      />
      <PasswordField
        id="login-password"
        label="Password"
        registration={form.register("password")}
        autoComplete="current-password"
        error={form.formState.errors.password?.message}
      />
      <AnimatePresence initial={false}>
      {mfaRequired ? (
        <motion.div
          key="mfa-challenge"
          initial={{ opacity: 0, height: 0, y: -8 }}
          animate={{ opacity: 1, height: "auto", y: 0 }}
          exit={{ opacity: 0, height: 0, y: -8 }}
          transition={{ duration: 0.26, ease: "easeOut" }}
          className="space-y-3 overflow-hidden"
        >
          <p role="status" className="text-sm text-white/65">
            {mfaReason === "network_changed"
              ? "Your network changed since this browser was last verified. Confirm it is you with your authenticator."
              : "Verify this new browser with your authenticator."}
          </p>
          <Field
            id="code"
            label="Authenticator or recovery code"
            autoComplete="one-time-code"
            inputMode="numeric"
            registration={form.register("code")}
            error={form.formState.errors.code?.message}
          />
          <label className="flex items-start gap-3 text-sm text-white/60">
            <input
              type="checkbox"
              checked={trustBrowser}
              onChange={(event) => setTrustBrowser(event.target.checked)}
              className="mt-1 accent-(--accent)"
            />
            Trust this browser for 30 days (only on a device you control)
          </label>
        </motion.div>
      ) : null}
      </AnimatePresence>
      <div className="space-y-2">
        <Label htmlFor="history-recovery-code">Message history recovery code</Label>
        <Input
          id="history-recovery-code"
          autoComplete="off"
          value={historyRecoveryCode}
          onChange={(event) => setHistoryRecoveryCode(event.target.value)}
          placeholder="Only needed after a password reset"
        />
        <p className="text-xs text-white/35">
          Use the saved code if you reset your password and need to unlock older encrypted messages.
        </p>
      </div>
      <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
        <label className="flex items-start gap-3 text-sm text-white/75">
          <input
            type="checkbox"
            checked={restoreFromDrive}
            disabled={!driveConfigured}
            onChange={(event) => {
              setRestoreFromDrive(event.target.checked);
              setDriveAccessToken(null);
              setDriveError(null);
            }}
            className="mt-1 accent-(--accent)"
          />
          Restore my encrypted archive key from Google Drive
        </label>
        <AnimatePresence initial={false}>
        {restoreFromDrive ? (
          <motion.div
            key="drive-restore"
            initial={{ opacity: 0, height: 0, y: -6 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -6 }}
            className="overflow-hidden"
          >
          <>
            <p className="text-xs text-white/45">
              The recovery code decrypts the backup on this device. Google Drive receives no
              recovery code or plaintext key.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!driveReady || driveConnecting || !historyRecoveryCode.trim()}
              onClick={() => void connectGoogleDrive()}
            >
              {driveConnecting
                ? "Connecting…"
                : driveAccessToken
                  ? "Google Drive connected"
                  : driveReady
                    ? "Connect Google Drive"
                    : "Loading Google sign-in…"}
            </Button>
            {driveError ? <p role="alert" className="text-sm text-red-300">{driveError}</p> : null}
          </>
          </motion.div>
        ) : null}
        </AnimatePresence>
        {!driveConfigured ? (
          <p className="text-xs text-white/40">
            Google Drive recovery is unavailable until this app is configured with a Google OAuth client ID.
          </p>
        ) : null}
      </div>
      <div className="-mt-3 text-right text-sm">
        <Link href="/forgot-password" className="text-white/55 hover:text-white">
          Forgot password?
        </Link>
      </div>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="totp-error"
            role="alert"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            className="overflow-hidden text-sm text-red-300"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting
          ? "Working…"
          : mfaRequired
            ? "Verify and continue"
            : "Continue"}
      </Button>
    </form>
    </AnimatedAuthStage>
  );
}

function TotpEnrollment({
  setup,
  error,
  onConfirm,
}: {
  setup: TotpSetup;
  error: string | null;
  onConfirm: (code: string, trustBrowser: boolean) => Promise<void>;
}) {
  const [trustBrowser, setTrustBrowser] = useState(false);
  const form = useForm<{ code: string }>({
    defaultValues: { code: "" },
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium">Secure your account with an authenticator</p>
        <p className="mt-2 text-sm text-white/45">
          Add Private Messenger to an authenticator app, then enter its current six-digit code.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
        <p className="text-sm font-medium">Scan with your authenticator app</p>
        <div className="rounded-xl bg-white p-3">
          <QRCodeSVG
            value={setup.otpauthUrl}
            size={208}
            level="M"
            title="Authenticator setup QR code"
          />
        </div>
        <p className="text-xs text-white/45">
          The QR code contains your secret setup key. Keep it private.
        </p>
      </div>
      <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4">
        <Label htmlFor="totp-secret">Manual setup key</Label>
        <code id="totp-secret" className="block break-all text-sm tracking-wider text-white">
          {setup.secret}
        </code>
        <a
          href={setup.otpauthUrl}
          className="inline-block pt-2 text-xs text-(--accent) underline underline-offset-4"
        >
          Open authenticator app
        </a>
      </div>
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit(({ code }) => onConfirm(code, trustBrowser))}
      >
        <Field
          id="totp-confirm-code"
          label="Six-digit code"
          autoComplete="one-time-code"
          inputMode="numeric"
          registration={form.register("code", {
            required: true,
            pattern: /^\d{6}$/,
          })}
          error={
            form.formState.errors.code
              ? "Enter the current six-digit authenticator code."
              : undefined
          }
        />
        <label className="flex items-start gap-3 text-sm text-white/60">
          <input
            type="checkbox"
            checked={trustBrowser}
            onChange={(event) => setTrustBrowser(event.target.checked)}
            className="mt-1 accent-(--accent)"
          />
          Trust this browser for 30 days (only on a device you control)
        </label>
        <AnimatePresence initial={false}>
          {error ? (
            <motion.p
              key="recovery-error"
              role="alert"
              initial={{ opacity: 0, height: 0, y: -4 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -4 }}
              className="overflow-hidden text-sm text-red-300"
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Verifying…" : "Verify and enable MFA"}
        </Button>
      </form>
    </div>
  );
}

function RecoveryCodes({
  codes,
  archiveRecoveryCode,
  error,
  vaultReady,
  celebrate = false,
  onContinue,
}: {
  codes: string[];
  archiveRecoveryCode: string | null;
  error: string | null;
  vaultReady: boolean;
  celebrate?: boolean;
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
        ...(archiveRecoveryCode
          ? ["Message history recovery code:", archiveRecoveryCode]
          : []),
      ].join("\n"));
      setCopied(true);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="space-y-5">
      {celebrate ? <SignupCelebration /> : null}
      <div>
        <h2 className="text-lg font-medium">
          {celebrate
            ? "Welcome to Private. Your account is ready!"
            : codes.length
              ? "Save your recovery codes"
              : "Save your message history recovery code"}
        </h2>
        <p className="mt-2 text-sm text-white/45">
          {codes.length
            ? "Each authenticator recovery code works once if you cannot access your authenticator. "
            : ""}
          {archiveRecoveryCode
            ? "The separate history recovery code unlocks older messages after a password reset. Save it somewhere private before continuing."
            : "These codes are shown only now."}
        </p>
      </div>
      {codes.length ? (
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-black/20 p-4 font-mono text-sm">
          {codes.map((code) => <span key={code}>{code}</span>)}
        </div>
      ) : null}
      {archiveRecoveryCode ? (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
          <p className="mb-2 text-xs text-white/55">Message history recovery code</p>
          <code className="block break-all font-mono text-sm text-white">{archiveRecoveryCode}</code>
        </div>
      ) : null}
      {archiveRecoveryCode ? (
        <label className="flex items-start gap-3 text-sm text-white/65">
          <input
            type="checkbox"
            checked={recoveryCodeSaved}
            onChange={(event) => setRecoveryCodeSaved(event.target.checked)}
            className="mt-1 accent-(--accent)"
          />
          I saved this history recovery code somewhere private.
        </label>
      ) : null}
      <Button type="button" variant="outline" className="w-full" onClick={copyCodes}>
        {copied ? "Copied" : "Copy recovery information"}
      </Button>
      {copyError ? <p className="text-sm text-red-300">Clipboard access is unavailable; copy the codes manually.</p> : null}
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="totp-error"
            role="alert"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            className="overflow-hidden text-sm text-red-300"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <Button
        type="button"
        className="w-full"
        disabled={Boolean(archiveRecoveryCode && !recoveryCodeSaved)}
        onClick={() => void onContinue()}
      >
        {vaultReady ? "Continue to inbox" : "Finish secure device setup"}
      </Button>
    </div>
  );
}

function SignupCelebration() {
  const reduceMotion = useReducedMotion();
  const colors = ["#a5b4fc", "#67e8f9", "#f0abfc", "#86efac", "#fde68a"];
  return (
    <div className="signup-celebration relative overflow-hidden rounded-2xl border border-(--accent)/20 bg-(--accent)/[0.07] p-4 text-center">
      <div className="signup-celebration-burst" aria-hidden="true">
        {Array.from({ length: 22 }, (_, index) => {
          const angle = (Math.PI * 2 * index) / 22;
          const distance = 55 + (index % 4) * 13;
          return (
            <motion.span
              key={index}
              className="signup-confetti"
              style={{ backgroundColor: colors[index % colors.length] }}
              initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.4 }}
              animate={reduceMotion ? { opacity: 0 } : {
                x: Math.cos(angle) * distance,
                y: Math.sin(angle) * distance,
                opacity: [0, 1, 0],
                rotate: 220 + index * 16,
                scale: [0.4, 1, 0.65],
              }}
              transition={{ duration: 1.15, delay: index * 0.012, ease: "easeOut" }}
            />
          );
        })}
      </div>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.6, rotate: -18 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 16, delay: reduceMotion ? 0 : 0.08 }}
        className="relative mx-auto mb-2 grid size-11 place-items-center rounded-full border border-emerald-200/20 bg-emerald-300/10 text-xl text-emerald-200"
        aria-hidden="true"
      >
        ✓
      </motion.div>
      <p className="relative text-xs text-white/55">
        Your secure setup is complete. A little celebration is in order.
      </p>
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
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not request password recovery. Try again later.",
          );
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
      <AnimatePresence initial={false}>
        {message ? (
          <motion.p
            key="reset-link-sent"
            role="status"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] p-3 text-sm text-emerald-200"
          >
            {message}
          </motion.p>
        ) : null}
        {error ? (
          <motion.p
            key="forgot-error"
            role="alert"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-sm text-red-300"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
      </Button>
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

  if (complete) {
    return (
      <AnimatedAuthStage stage="password-reset-complete">
      <div className="space-y-4 text-center">
        <p className="text-sm text-emerald-300">Password reset. Sign in and create a new device vault.</p>
        <p className="text-sm text-white/45">
          Old device keys are not restored. Use your saved message history recovery code at sign-in to unlock the portable encrypted archive.
        </p>
        <Link href="/login" className="inline-block text-sm text-white underline underline-offset-4">
          Continue to login
        </Link>
      </div>
      </AnimatedAuthStage>
    );
  }

  return (
    <AnimatedAuthStage stage="password-reset-form">
    <form
      className="space-y-5"
      onSubmit={form.handleSubmit(async (values) => {
        setError(null);
        try {
          await api.resetPassword(values);
          setComplete(true);
        } catch (err) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not reset the password. The link may have expired.",
          );
        }
      })}
    >
      <input type="hidden" {...form.register("token")} />
      <PasswordField
        id="reset-password"
        label="New password"
        registration={form.register("password")}
        autoComplete="new-password"
        error={form.formState.errors.password?.message}
      />
      <PasswordField
        id="reset-password-confirm"
        label="Repeat new password"
        registration={form.register("passwordConfirm")}
        autoComplete="new-password"
        error={form.formState.errors.passwordConfirm?.message}
      />
      <Field
        id="reset-code"
        label="Authenticator or recovery code"
        autoComplete="one-time-code"
        inputMode="numeric"
        registration={form.register("code")}
        error={form.formState.errors.code?.message}
      />
      <p className="-mt-3 text-xs text-white/35">
        Use at least 12 characters. A valid authenticator or unused recovery code is also required.
      </p>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.p
            key="password-reset-error"
            role="alert"
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            className="overflow-hidden text-sm text-red-300"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
      <Button type="submit" className="w-full" disabled={!token || form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Resetting…" : "Reset password"}
      </Button>
    </form>
    </AnimatedAuthStage>
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
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        {...registration}
      />
      {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}

function PasswordField({
  id,
  label,
  registration,
  autoComplete,
  error,
}: {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  autoComplete: string;
  error?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" autoComplete={autoComplete} {...registration} />
      {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}

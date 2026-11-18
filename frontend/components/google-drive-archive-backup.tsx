"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createGoogleDriveArchiveBackup,
  currentUserId,
} from "@/lib/session";
import {
  isGoogleDriveArchiveConfigured,
  loadGoogleIdentityServices,
  requestGoogleDriveAccessToken,
  uploadGoogleDriveArchiveBackup,
} from "@/lib/google-drive-archive";

export function GoogleDriveArchiveBackup() {
  const [open, setOpen] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const configured = isGoogleDriveArchiveConfigured();

  useEffect(() => {
    if (!configured) return;
    void loadGoogleIdentityServices().then(
      () => setReady(true),
      (loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Could not load Google sign-in.");
      },
    );
  }, [configured]);

  async function createBackup() {
    const userId = currentUserId();
    if (!userId) {
      setError("Unlock your account before creating a backup.");
      return;
    }
    if (!recoveryCode.trim()) {
      setError("Enter your message history recovery code to encrypt this backup.");
      return;
    }

    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const tokenPromise = requestGoogleDriveAccessToken();
      const backup = await createGoogleDriveArchiveBackup(userId, recoveryCode);
      const token = await tokenPromise;
      await uploadGoogleDriveArchiveBackup(token, backup);
      setStatus("The encrypted archive key backup is saved in Google Drive.");
      setRecoveryCode("");
    } catch (backupError) {
      setError(
        backupError instanceof Error
          ? backupError.message
          : "Could not save the encrypted backup to Google Drive.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          setOpen(true);
          setError(null);
          setStatus(null);
        }}
      >
        Encrypted Drive backup
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="drive-archive-title"
            className="w-full max-w-lg space-y-4 rounded-3xl border border-white/10 bg-[#15171d] p-6 shadow-2xl"
          >
            <h2 id="drive-archive-title" className="text-lg font-semibold">
              Encrypted Google Drive backup
            </h2>
            <p className="text-sm text-white/60">
              The archive key is encrypted on this device with your 256-bit history recovery code
              before upload. Google receives only ciphertext. Your code is never sent to Google.
              Keep the code separately; Drive access alone cannot decrypt the backup.
            </p>
            {!configured ? (
              <p role="alert" className="text-sm text-amber-200">
                Google Drive is not configured. Set NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID and the
                app&apos;s authorized origin in Google Cloud.
              </p>
            ) : null}
            <label htmlFor="drive-archive-recovery-code" className="block text-sm text-white/75">
              Message history recovery code
            </label>
            <Input
              id="drive-archive-recovery-code"
              type="password"
              autoComplete="off"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              placeholder="Enter your saved recovery code"
            />
            {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
            {status ? <p role="status" className="text-sm text-emerald-200">{status}</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
              <Button
                type="button"
                disabled={!configured || !ready || busy || !recoveryCode.trim()}
                onClick={() => void createBackup()}
              >
                {busy ? "Creating backup…" : ready ? "Back up to Google Drive" : "Loading Google sign-in…"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

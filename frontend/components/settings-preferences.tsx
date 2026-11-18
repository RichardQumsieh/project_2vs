"use client";

import { GoogleDriveArchiveBackup } from "@/components/google-drive-archive-backup";
import { ThemeControl } from "@/components/theme-control";

export function SettingsPreferences() {
  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-2">
      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
        <h2 className="text-lg font-medium text-white">Appearance</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/55">
          Theme is saved in this browser. The inbox keeps a single look and does not carry a light/dark toggle.
        </p>
        <div className="mt-4">
          <ThemeControl />
        </div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
        <h2 className="text-lg font-medium text-white">Encrypted Google Drive backup</h2>
        <p className="mt-2 mb-4 text-sm leading-relaxed text-white/55">
          Back up the encrypted archive key from here. The inbox no longer shows this control. Google receives ciphertext only.
        </p>
        <GoogleDriveArchiveBackup />
      </section>
    </div>
  );
}

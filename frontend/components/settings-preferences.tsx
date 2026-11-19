"use client";

import { GoogleDriveArchiveBackup } from "@/components/google-drive-archive-backup";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeControl } from "@/components/theme-control";
import { useI18n } from "@/lib/i18n/locale";

export function SettingsPreferences() {
  const { t } = useI18n();
  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-2">
      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
        <h2 className="text-lg font-medium text-white">{t("settings.appearance")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/55">
          {t("settings.appearanceBody")}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <LanguageSwitcher />
          <ThemeControl />
        </div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
        <h2 className="text-lg font-medium text-white">{t("settings.driveTitle")}</h2>
        <p className="mt-2 mb-4 text-sm leading-relaxed text-white/55">
          {t("settings.driveBody")}
        </p>
        <GoogleDriveArchiveBackup />
      </section>
    </div>
  );
}

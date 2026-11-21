"use client";

import { useThemePreference } from "@/components/theme-provider";
import { useI18n } from "@/lib/i18n/locale";

export function ThemeControl() {
  const { theme, setTheme, persistenceError } = useThemePreference();
  const { t } = useI18n();

  return (
    <div className="theme-control">
      <label htmlFor="theme-preference">{t("settings.theme")}</label>
      <select
        id="theme-preference"
        title={t("settings.theme")}
        aria-label={t("settings.theme")}
        value={theme}
        onChange={(event) => {
          const selected = event.currentTarget.value;
          if (
            selected === "system" ||
            selected === "light" ||
            selected === "dark"
          ) {
            setTheme(selected);
          }
        }}
      >
        <option value="system">{t("settings.themeSystem")}</option>
        <option value="light">{t("settings.themeLight")}</option>
        <option value="dark">{t("settings.themeDark")}</option>
      </select>
      {persistenceError ? (
        <span role="status" className="theme-control-error">
          {t("settings.themeSaveFailed")}
        </span>
      ) : null}
    </div>
  );
}

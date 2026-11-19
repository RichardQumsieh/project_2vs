"use client";

import { useI18n, type Locale } from "@/lib/i18n/locale";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  function choose(next: Locale) {
    setLocale(next);
  }

  return (
    <div
      role="group"
      aria-label={t("lang.switch")}
      className={`language-switcher inline-flex items-center rounded-full border border-(--line) bg-(--control-bg) p-0.5 ${className}`.trim()}
    >
      <button
        type="button"
        aria-pressed={locale === "en"}
        className={buttonClass(locale === "en")}
        onClick={() => choose("en")}
      >
        {t("lang.english")}
      </button>
      <button
        type="button"
        aria-pressed={locale === "ar"}
        className={buttonClass(locale === "ar")}
        onClick={() => choose("ar")}
      >
        {t("lang.arabic")}
      </button>
    </div>
  );
}

function buttonClass(active: boolean) {
  return `min-h-11 rounded-full px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) ${
    active
      ? "bg-(--foreground) text-(--background)"
      : "text-(--muted) hover:text-(--foreground)"
  }`;
}

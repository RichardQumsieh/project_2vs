import type { Locale } from "@/lib/i18n/locale";

export function formatBriefWhen(iso: string, timeZone: string, locale: Locale) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ar, en, type MessageKey } from "./messages";

export type Locale = "en" | "ar";
export type { MessageKey };

export const LOCALE_STORAGE_KEY = "sophia-locale";

export type TranslateVars = Record<string, string | number>;

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: TranslateVars,
): string {
  const template = (locale === "ar" ? ar : en)[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] === undefined ? "" : String(vars[name]),
  );
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "ar";
}

export function directionForLocale(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const query = new URLSearchParams(window.location.search).get("lang");
    if (isLocale(query)) return query;
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : "en";
  } catch {
    return "en";
  }
}

export function applyDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "ar" ? "ar" : "en";
  document.documentElement.dir = directionForLocale(locale);
}

type LocaleContextValue = {
  locale: Locale;
  dir: "rtl" | "ltr";
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: TranslateVars) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored);
    applyDocumentLocale(stored);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, stored);
    } catch {
      // Private mode can reject storage; the document direction still applies.
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    applyDocumentLocale(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; the in-memory locale still updates the UI.
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dir: directionForLocale(locale),
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    return {
      locale: "en",
      dir: "ltr",
      setLocale: () => {},
      t: (key, vars) => translate("en", key, vars),
    };
  }
  return value;
}

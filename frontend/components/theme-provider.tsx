"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemePreference = "system" | "light" | "dark";

type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  persistenceError: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const storageKey = "private-app-theme";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [persistenceError, setPersistenceError] = useState(false);
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    let frame: number;
    try {
      const saved = window.localStorage.getItem(storageKey);
      frame = window.requestAnimationFrame(() => {
        if (isThemePreference(saved)) setThemeState(saved);
        setThemeReady(true);
      });
    } catch {
      frame = window.requestAnimationFrame(() => {
        setPersistenceError(true);
        setThemeReady(true);
      });
    }

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
  }, [theme, themeReady]);

  useEffect(() => {
    function syncTheme(event: StorageEvent) {
      if (event.key === storageKey && isThemePreference(event.newValue)) {
        setThemeState(event.newValue);
      }
    }
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    setThemeState(nextTheme);
    try {
      window.localStorage.setItem(storageKey, nextTheme);
      setPersistenceError(false);
    } catch {
      setPersistenceError(true);
    }
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, persistenceError }),
    [theme, setTheme, persistenceError],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemePreference must be used within ThemeProvider");
  }
  return context;
}

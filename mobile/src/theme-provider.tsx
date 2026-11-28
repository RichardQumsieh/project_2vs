import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { api } from "./api";
import { parseGeneratedTheme, type GeneratedTheme } from "../../frontend/lib/themes/tokens";
import { bubbleColors } from "./theme-surface";

type ThemeValue = {
  theme: GeneratedTheme | null;
  scheme: "light" | "dark";
  refresh: () => Promise<void>;
};

const ThemeContext = createContext<ThemeValue>({
  theme: null,
  scheme: "light",
  refresh: async () => undefined,
});

export function MobileThemeProvider({ cookie, children }: { cookie: string | null; children: React.ReactNode }) {
  const scheme: "light" | "dark" = useColorScheme() === "dark" ? "dark" : "light";
  const [theme, setTheme] = useState<GeneratedTheme | null>(null);
  const refresh = useMemo(() => async () => {
    if (!cookie) {
      setTheme(null);
      return;
    }
    try {
      const applied = await api.appliedThemes(cookie);
      const tokens = applied.app && !applied.app.wallpaperOnly ? parseGeneratedTheme(applied.app.theme.tokens) : null;
      setTheme(tokens);
    } catch {
      setTheme(null);
    }
  }, [cookie]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const value = useMemo(() => ({ theme, scheme, refresh }), [theme, scheme, refresh]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useMobileTheme() {
  return useContext(ThemeContext);
}

export function useBubbleStyle(mine: boolean) {
  const { theme, scheme } = useMobileTheme();
  return bubbleColors(theme, scheme, mine);
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api";
import { wallpaperDataUri } from "@/lib/themes/wallpaper";
import {
  parseGeneratedTheme,
  themeCssVariables,
  type GeneratedTheme,
  type SavedTheme,
  readSavedTheme,
} from "@/lib/themes/tokens";

type Applied = {
  app: { wallpaperOnly: boolean; theme: SavedTheme } | null;
  chats: { conversationId: string; wallpaperOnly: boolean; theme: SavedTheme }[];
};

type GeneratedThemeContextValue = {
  applied: Applied;
  preview: GeneratedTheme | null;
  setPreview: (theme: GeneratedTheme | null) => void;
  refresh: () => Promise<void>;
  wallpaperFor: (conversationId?: string | null) => string | null;
};

const empty: Applied = { app: null, chats: [] };
const GeneratedThemeContext = createContext<GeneratedThemeContextValue | null>(null);

function prefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyVariables(theme: GeneratedTheme | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!theme) {
    delete root.dataset.generatedTheme;
    for (const key of [
      "--surface", "--primary", "--secondary", "--bubble-mine", "--bubble-mine-text",
      "--bubble-theirs", "--bubble-theirs-text", "--theme-radius", "--theme-font-weight", "--icon-accent",
    ]) root.style.removeProperty(key);
    return;
  }
  const mode = root.dataset.theme === "light" ? "light" : root.dataset.theme === "dark" ? "dark" : prefersDark() ? "dark" : "light";
  const variables = themeCssVariables(theme, mode);
  root.dataset.generatedTheme = "on";
  for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value);
}

export function GeneratedThemeProvider({ children }: { children: React.ReactNode }) {
  const [applied, setApplied] = useState<Applied>(empty);
  const [preview, setPreview] = useState<GeneratedTheme | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await api.appliedThemes();
      const appTheme = response.app ? { wallpaperOnly: response.app.wallpaperOnly, theme: readSavedTheme(response.app.theme) } : null;
      const chats = response.chats.flatMap((chat) => {
        const theme = readSavedTheme(chat.theme);
        return theme ? [{ conversationId: chat.conversationId, wallpaperOnly: chat.wallpaperOnly, theme }] : [];
      });
      setApplied({
        app: appTheme?.theme ? { wallpaperOnly: appTheme.wallpaperOnly, theme: appTheme.theme } : null,
        chats,
      });
    } catch {
      setApplied(empty);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const active = preview ?? (applied.app && !applied.app.wallpaperOnly ? applied.app.theme.tokens : null);
    applyVariables(active && parseGeneratedTheme(active) ? active : null);
  }, [applied, preview]);

  const wallpaperFor = useCallback((conversationId?: string | null) => {
    const chat = conversationId ? applied.chats.find((item) => item.conversationId === conversationId) : undefined;
    const source = preview?.wallpaper ?? chat?.theme.tokens.wallpaper ?? applied.app?.theme.tokens.wallpaper;
    if (!source) return null;
    try {
      return wallpaperDataUri(source);
    } catch {
      return null;
    }
  }, [applied, preview]);

  const value = useMemo(
    () => ({ applied, preview, setPreview, refresh, wallpaperFor }),
    [applied, preview, refresh, wallpaperFor],
  );

  return <GeneratedThemeContext.Provider value={value}>{children}</GeneratedThemeContext.Provider>;
}

export function useGeneratedTheme() {
  const value = useContext(GeneratedThemeContext);
  if (!value) throw new Error("useGeneratedTheme must be used within GeneratedThemeProvider");
  return value;
}

export function useChatWallpaper(conversationId?: string | null): { backgroundImage?: string; backgroundSize?: string } {
  const { wallpaperFor } = useGeneratedTheme();
  const image = wallpaperFor(conversationId);
  if (!image) return {};
  return { backgroundImage: `linear-gradient(rgba(8,13,22,0.55), rgba(8,13,22,0.72)), url("${image}")`, backgroundSize: "cover" };
}

import { accentInk, mutedColor } from "./contrast";
import type { AppearanceTokens } from "./schema";
import { backgroundCss, paletteFor } from "./tokens";

export function applyAppearance(
  tokens: AppearanceTokens | null,
  options: { uploadUrl?: string | null; prefersDark?: boolean } = {},
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!tokens) {
    delete root.dataset.appearance;
    delete root.dataset.density;
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-rgb");
    root.style.removeProperty("--accent-ink");
    root.style.removeProperty("--background");
    root.style.removeProperty("--foreground");
    root.style.removeProperty("--muted");
    root.style.removeProperty("--font-scale");
    root.style.removeProperty("--density-scale");
    root.style.removeProperty("--appearance-image");
    root.dataset.theme = savedTheme();
    return;
  }
  const prefersDark = options.prefersDark ?? prefersDarkScheme();
  const palette = paletteFor(tokens.colorMode, prefersDark);
  const rgb = hexChannels(tokens.accent);
  root.dataset.appearance = "on";
  root.dataset.density = tokens.density;
  root.dataset.theme = tokens.colorMode;
  root.style.setProperty("--accent", tokens.accent);
  root.style.setProperty("--accent-rgb", rgb);
  root.style.setProperty("--accent-ink", accentInk(tokens.accent));
  root.style.setProperty("--background", palette.background);
  root.style.setProperty("--foreground", palette.foreground);
  root.style.setProperty("--muted", mutedColor(palette.foreground, palette.background));
  root.style.setProperty("--font-scale", String(tokens.fontScale));
  root.style.setProperty("--density-scale", densityVariable(tokens.density));
  const image = backgroundCss(tokens, options.uploadUrl ?? null);
  if (image) root.style.setProperty("--appearance-image", image);
  else root.style.removeProperty("--appearance-image");
}

function densityVariable(density: AppearanceTokens["density"]): string {
  if (density === "compact") return "0.85";
  if (density === "spacious") return "1.15";
  return "1";
}

function hexChannels(hex: string): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function savedTheme(): string {
  if (typeof window === "undefined") return "system";
  try {
    const saved = window.localStorage.getItem("private-app-theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Keep the stylesheet default when storage is blocked.
  }
  return "system";
}

function prefersDarkScheme(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

import type { GeneratedTheme } from "../../frontend/lib/themes/tokens";

export function bubbleColors(theme: GeneratedTheme | null, scheme: "light" | "dark", mine: boolean) {
  if (!theme) return null;
  const palette = theme[scheme];
  return {
    backgroundColor: mine ? palette.bubbleMine : palette.bubbleTheirs,
    color: mine ? palette.textOnMine : palette.textOnTheirs,
    borderRadius: theme.cornerRadius,
  };
}

export function screenColors(theme: GeneratedTheme | null, scheme: "light" | "dark") {
  if (!theme) return null;
  const palette = theme[scheme];
  return {
    backgroundColor: palette.background,
    color: palette.text,
    accent: palette.accent,
    icon: theme.iconAccent,
  };
}

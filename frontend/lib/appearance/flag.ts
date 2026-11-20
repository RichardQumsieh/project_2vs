/**
 * Adaptive appearance is on unless this public flag is exactly "false".
 * Production enables it by default so Sophia can apply requested themes.
 */
export function adaptiveThemeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED !== "false";
}

/**
 * Adaptive appearance is off unless this public flag is exactly "true".
 * Production Compose leaves it unset, which stays off.
 */
export function adaptiveThemeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED === "true";
}

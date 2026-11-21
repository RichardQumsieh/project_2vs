/**
 * Adaptive appearance is on unless this public flag is exactly "false".
 * Unset and empty stay on. A production build does not need the flag set.
 */
export function adaptiveThemeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED !== "false";
}

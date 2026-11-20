/** Product switch for the manager daily brief. The API flag is the real gate. */
export function dailyBriefEnabled() {
  return process.env.NEXT_PUBLIC_DAILY_BRIEF_ENABLED === "true";
}

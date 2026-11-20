/** On unless NEXT_PUBLIC_DAILY_BRIEF_ENABLED is exactly "false". */
export function dailyBriefEnabled() {
  return process.env.NEXT_PUBLIC_DAILY_BRIEF_ENABLED !== "false";
}

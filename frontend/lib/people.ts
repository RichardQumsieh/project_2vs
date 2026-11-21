/** Strip a leading @ so "@benjoe" matches the username benjoe. */
export function memberSearchNeedle(query: string): string {
  return query.trim().replace(/^@+/, "").replace(/\s+/g, " ").toLowerCase();
}

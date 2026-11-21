/** On unless the value is exactly "false". Unset, empty, and "true" stay on. */
export function parseGroupE2eeEnabled(value: unknown): boolean {
  return value !== "false";
}

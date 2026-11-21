/**
 * Group create stays on unless this public flag is exactly "false".
 * The API flag GROUP_E2EE_ENABLED is the server gate and uses the same rule.
 */
export function groupE2eeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GROUP_E2EE_ENABLED !== "false";
}

export function assertGroupE2eeEnabled(): void {
  if (!groupE2eeEnabled()) {
    throw new Error(
      "Group E2EE is disabled. Set NEXT_PUBLIC_GROUP_E2EE_ENABLED=true and GROUP_E2EE_ENABLED=true on the API.",
    );
  }
}

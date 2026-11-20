/** Safety numbers stay on unless this public flag is exactly "false". */
export function safetyNumbersEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED !== "false";
}

export function assertSafetyNumbersEnabled(): void {
  if (!safetyNumbersEnabled()) {
    throw new Error(
      "Safety numbers are disabled. NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED is false.",
    );
  }
}

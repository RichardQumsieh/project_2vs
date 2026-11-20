/** Safety numbers are off unless this public flag is exactly "true". */
export function safetyNumbersEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED === "true";
}

export function assertSafetyNumbersEnabled(): void {
  if (!safetyNumbersEnabled()) {
    throw new Error(
      "Safety numbers are disabled. Set NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED=true and SAFETY_NUMBERS_ENABLED=true on the API.",
    );
  }
}

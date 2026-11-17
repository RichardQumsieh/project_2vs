/** Public Express API origin used when NEXT_PUBLIC_API_URL is unset. */
export const DEFAULT_PRODUCTION_API_URL =
  "https://api.sophia-build.com";

export const DEFAULT_DEV_API_URL =
  "http://localhost:3001";

/**
 * Resolve the browser-facing API base URL.
 * Prefer build-time `NEXT_PUBLIC_API_URL`; otherwise use the live API in
 * production builds and localhost in development.
 */
export function resolveApiUrl(
  explicit?: string | null,
): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }

  return process.env.NODE_ENV === "production"
    ? DEFAULT_PRODUCTION_API_URL
    : DEFAULT_DEV_API_URL;
}

/** Published Sophia web app. Always allowed, even when FRONTEND_ORIGIN differs. */
export const PUBLISHED_FRONTEND_ORIGIN = "https://sophia.apps.grok.bot";

/**
 * Credentialed browser calls (cookies) may come from the published app or from
 * whatever FRONTEND_ORIGIN this process was started with. Never "*":
 * browsers reject a wildcard together with credentials.
 */
export function allowedFrontendOrigins(configuredOrigin: string): string[] {
  const origins = new Set<string>([PUBLISHED_FRONTEND_ORIGIN]);
  try {
    origins.add(new URL(configuredOrigin).origin);
  } catch {
    // Env validation already requires a URL. Ignore a bad value here.
  }
  return [...origins];
}

export function isAllowedFrontendOrigin(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  return typeof origin === "string" && origin.length > 0 && allowed.includes(origin);
}

/** Headers for a hijacked response. @fastify/cors does not run after reply.hijack(). */
export function credentialedCorsHeaders(
  origin: string | undefined,
  allowed: readonly string[],
): Record<string, string> {
  if (!isAllowedFrontendOrigin(origin, allowed)) return {};
  return {
    "Access-Control-Allow-Origin": origin as string,
    Vary: "Origin",
    "Access-Control-Allow-Credentials": "true",
  };
}

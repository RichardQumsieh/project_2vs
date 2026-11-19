import { resolveApiUrl } from "./api-url";

export function createContentSecurityPolicy(
  nonce: string,
  options: { development: boolean; apiUrl?: string },
) {
  const apiOrigin = new URL(resolveApiUrl(options.apiUrl));
  const apiWebSocketOrigin = new URL(apiOrigin);
  apiWebSocketOrigin.protocol = apiOrigin.protocol === "https:" ? "wss:" : "ws:";

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://accounts.google.com",
    ...(options.development ? ["'unsafe-eval'"] : []),
  ];
  const connectionSources = [
    "'self'",
    apiOrigin.origin,
    apiWebSocketOrigin.origin,
    "https://accounts.google.com",
    "https://oauth2.googleapis.com",
    "https://www.googleapis.com",
    "https://*.backblazeb2.com",
    ...(options.development
      ? ["ws://localhost:3000", "ws://127.0.0.1:3000"]
      : []),
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectionSources.join(" ")}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "frame-src https://accounts.google.com https://www.youtube-nocookie.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

export const frontendHstsHeaderValue = "max-age=15552000";

/** Document headers for the Next.js app. CSP is attached separately because it carries a nonce. */
export function frontendDocumentSecurityHeaders(protocol: string): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self)",
  };
  if (protocol === "https" || protocol === "https:") {
    headers["Strict-Transport-Security"] = frontendHstsHeaderValue;
  }
  return headers;
}

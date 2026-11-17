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

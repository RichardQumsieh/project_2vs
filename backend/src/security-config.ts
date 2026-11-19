import { isIP } from "node:net";

/**
 * Production HTTP settings that do not read the environment themselves.
 * Callers pass already-parsed values so tests can cover them without booting the API.
 */

export const hstsHeaderValue = "max-age=15552000";

export type AuthCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax" | "none";
  path: "/";
};

export function authCookieOptions(secure: boolean): AuthCookieOptions {
  return {
    httpOnly: true,
    secure,
    // Cross-site SPA → API needs SameSite=None, which browsers accept only with Secure.
    sameSite: secure ? "none" : "lax",
    path: "/",
  };
}

export function assertProductionCookieSecure(nodeEnv: string | undefined, secure: boolean) {
  if (nodeEnv === "production" && secure !== true) {
    throw new Error(
      "COOKIE_SECURE must be true when NODE_ENV is production. Session cookies are cross-site and require HTTPS.",
    );
  }
}

/**
 * Fastify `trustProxy` value. `false` ignores X-Forwarded-* so clients cannot
 * spoof the peer address. A comma-separated IP/CIDR list trusts only those proxies.
 * `true` is rejected: it would trust every hop.
 */
export function parseTrustProxy(raw: string | undefined): false | string {
  const value = (raw ?? "").trim();
  if (value === "" || value.toLowerCase() === "false") return false;

  const lowered = value.toLowerCase();
  if (lowered === "true" || lowered === "*" || lowered === "all" || lowered === "1") {
    throw new Error(
      "TRUST_PROXY must be a comma-separated list of proxy IPs or CIDRs. Refusing to trust every forwarded address.",
    );
  }

  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return false;

  for (const part of parts) {
    if (!isIpOrCidr(part)) {
      throw new Error(`TRUST_PROXY entry is not an IP address or CIDR: ${part}`);
    }
  }

  return parts.join(",");
}

function isIpOrCidr(value: string) {
  if (isIP(value) !== 0) return true;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash !== value.lastIndexOf("/")) return false;
  const address = value.slice(0, slash);
  const bits = Number(value.slice(slash + 1));
  const family = isIP(address);
  if (!Number.isInteger(bits)) return false;
  if (family === 4) return bits >= 0 && bits <= 32;
  if (family === 6) return bits >= 0 && bits <= 128;
  return false;
}

export function isHttpsProtocol(protocol: string) {
  return protocol === "https" || protocol === "https:";
}

/** Headers for JSON API responses. TLS is terminated in front of this process. */
export function apiSecurityHeaders(protocol: string): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    "X-DNS-Prefetch-Control": "off",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (isHttpsProtocol(protocol)) {
    headers["Strict-Transport-Security"] = hstsHeaderValue;
  }
  return headers;
}

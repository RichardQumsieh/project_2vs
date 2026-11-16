import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type UrlReputationStatus = "clean" | "threat" | "unverifiable" | "unavailable";
export type UrlReputationResult = {
  url: string;
  status: UrlReputationStatus;
  threatTypes: string[];
};

const cacheDurationMs = 5 * 60_000;
const maxCacheEntries = 1_000;
const allowedThreatTypes = new Set([
  "MALWARE",
  "SOCIAL_ENGINEERING",
  "UNWANTED_SOFTWARE",
  "POTENTIALLY_HARMFUL_APPLICATION",
]);
const localHostnameSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".test",
  ".invalid",
  ".example",
];
const cache = new Map<string, { status: "clean" | "threat"; threatTypes: string[]; expiresAt: number }>();

function isPublicHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    !normalized.includes(".") ||
    normalized === "localhost" ||
    localHostnameSuffixes.some((suffix) => normalized.endsWith(suffix)) ||
    isIP(normalized) !== 0
  ) {
    return false;
  }
  return true;
}

export function normalizeReputationUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    return null;
  }
  url.hash = "";
  return {
    value: url.href,
    isPublic: isPublicHostname(url.hostname),
  };
}

function cacheKey(url: string) {
  return createHash("sha256").update(url).digest("hex");
}

function readCache(url: string, now: number) {
  const key = cacheKey(url);
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function writeCache(
  url: string,
  entry: { status: "clean" | "threat"; threatTypes: string[] },
  now: number,
) {
  const key = cacheKey(url);
  cache.delete(key);
  cache.set(key, { ...entry, expiresAt: now + cacheDurationMs });
  if (cache.size > maxCacheEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function checkUrlReputation(
  values: string[],
  options: {
    apiKey?: string;
    fetcher?: typeof fetch;
    now?: () => number;
  } = {},
): Promise<UrlReputationResult[]> {
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const normalized = values.map((value) => normalizeReputationUrl(value));
  if (normalized.some((entry) => entry === null)) {
    throw new Error("One or more URLs use an invalid or unsupported format.");
  }
  const urls = normalized as Array<NonNullable<(typeof normalized)[number]>>;
  const publicUrls = [...new Set(urls.filter((entry) => entry.isPublic).map((entry) => entry.value))];
  const resultsByUrl = new Map<string, UrlReputationResult>();
  const pending: string[] = [];

  for (const url of publicUrls) {
    const cached = readCache(url, now());
    if (cached) {
      resultsByUrl.set(url, {
        url,
        status: cached.status,
        threatTypes: cached.threatTypes,
      });
    } else {
      pending.push(url);
    }
  }

  if (pending.length > 0) {
    if (!options.apiKey) {
      for (const url of pending) {
        resultsByUrl.set(url, { url, status: "unavailable", threatTypes: [] });
      }
    } else {
      const endpoint = new URL("https://safebrowsing.googleapis.com/v4/threatMatches:find");
      endpoint.searchParams.set("key", options.apiKey);
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client: {
              clientId: "private-messenger",
              clientVersion: "1.0",
            },
            threatInfo: {
              threatTypes: [...allowedThreatTypes],
              platformTypes: ["ANY_PLATFORM"],
              threatEntryTypes: ["URL"],
              threatEntries: pending.map((url) => ({ url })),
            },
          }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new Error("URL reputation service could not be reached.");
      }
      if (!response.ok) {
        throw new Error("URL reputation service could not complete the check.");
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("URL reputation service returned an invalid response.");
      }
      if (!isRecord(payload)) {
        throw new Error("URL reputation service returned an invalid response.");
      }
      const matchesValue = payload.threatMatches;
      if (matchesValue !== undefined && !Array.isArray(matchesValue)) {
        throw new Error("URL reputation service returned an invalid response.");
      }

      const threatsByUrl = new Map<string, Set<string>>();
      for (const match of (matchesValue ?? []) as unknown[]) {
        if (
          !isRecord(match) ||
          !isRecord(match.threat) ||
          typeof match.threat.url !== "string" ||
          typeof match.threatType !== "string" ||
          !allowedThreatTypes.has(match.threatType)
        ) {
          throw new Error("URL reputation service returned an invalid threat record.");
        }
        const matchUrl = normalizeReputationUrl(match.threat.url);
        if (!matchUrl || !pending.includes(matchUrl.value)) {
          throw new Error("URL reputation service returned an invalid threat URL.");
        }
        const threatTypes = threatsByUrl.get(matchUrl.value) ?? new Set<string>();
        threatTypes.add(match.threatType);
        threatsByUrl.set(matchUrl.value, threatTypes);
      }

      for (const url of pending) {
        const threatTypes = [...(threatsByUrl.get(url) ?? [])];
        const status = threatTypes.length ? "threat" : "clean";
        const entry = { status, threatTypes } as const;
        writeCache(url, entry, now());
        resultsByUrl.set(url, { url, ...entry });
      }
    }
  }

  return urls.map((entry) => entry.isPublic
    ? resultsByUrl.get(entry.value)!
    : { url: entry.value, status: "unverifiable", threatTypes: [] });
}

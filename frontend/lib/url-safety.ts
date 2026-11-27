import { api } from "./api";
import { extractLinks, maxLinksPerMessage } from "./url-links";

export type { DetectedLink } from "./url-links";
export {
  extractLinks,
  isPublicReputationUrl,
  maxLinksPerMessage,
  uniqueReputationUrls,
  youtubeEmbedUrl,
} from "./url-links";

export type UrlSafetyResult = {
  url: string;
  status: "clean" | "threat" | "unverifiable" | "unavailable";
  threatTypes: string[];
};

const cacheDurationMs = 5 * 60_000;
const maxSafetyCacheEntries = 500;
const safetyCache = new Map<string, { result: UrlSafetyResult; expiresAt: number }>();
const queued = new Map<string, Array<{
  resolve: (result: UrlSafetyResult) => void;
  reject: (error: Error) => void;
}>>();
let flushScheduled = false;
let flushInProgress = false;

function flushQueue() {
  flushScheduled = false;
  if (flushInProgress || queued.size === 0) return;
  flushInProgress = true;
  const batch = [...queued.keys()].slice(0, 500);
  const waiting = new Map(batch.map((url) => [url, queued.get(url)!]));
  for (const url of batch) queued.delete(url);
  void api.checkUrlSafety(batch).then(({ results }) => {
    const resultsByUrl = new Map(results.map((result) => [result.url, result]));
    for (const url of batch) {
      const result = resultsByUrl.get(url);
      if (!result) {
        for (const waiter of waiting.get(url) ?? []) {
          waiter.reject(new Error("URL reputation service returned an incomplete result."));
        }
        continue;
      }
      safetyCache.delete(url);
      safetyCache.set(url, { result, expiresAt: Date.now() + cacheDurationMs });
      if (safetyCache.size > maxSafetyCacheEntries) {
        const oldestUrl = safetyCache.keys().next().value;
        if (oldestUrl) safetyCache.delete(oldestUrl);
      }
      for (const waiter of waiting.get(url) ?? []) waiter.resolve(result);
    }
  }).catch((error: unknown) => {
    const message = error instanceof Error
      ? error.message
      : "URL reputation service could not complete the check.";
    for (const waiters of waiting.values()) {
      for (const waiter of waiters) waiter.reject(new Error(message));
    }
  }).finally(() => {
    flushInProgress = false;
    if (queued.size > 0 && !flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flushQueue);
    }
  });
}

export function checkUrlsWithReputation(urls: string[]) {
  return Promise.all(urls.map((url) => {
    const cached = safetyCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.result);
    }
    if (cached) safetyCache.delete(url);
    return new Promise<UrlSafetyResult>((resolve, reject) => {
      const waiters = queued.get(url) ?? [];
      waiters.push({ resolve, reject });
      queued.set(url, waiters);
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flushQueue);
      }
    });
  }));
}

export async function assertOutgoingLinksSafe(text: string) {
  const links = extractLinks(text);
  if (links.length > maxLinksPerMessage) {
    throw new Error(`Messages can contain at most ${maxLinksPerMessage} links so each can be checked.`);
  }
  const invalid = links.find((link) => link.issue || !link.url);
  if (invalid) {
    throw new Error(invalid.issue ?? "This URL could not be verified safely.");
  }
  if (links.length === 0) return;

  const results = await checkUrlsWithReputation(links.map((link) => link.url!));
  const threats = results.filter((result) => result.status === "threat");
  if (threats.length > 0) {
    throw new Error(
      "Sending blocked: a link is reported for malware or phishing. Remove it and verify with the recipient another way.",
    );
  }
  if (results.some((result) => result.status !== "clean")) {
    throw new Error(
      "Sending blocked: one or more links could not be verified. Try again later or remove the link.",
    );
  }
}

import { api } from "./api";

export type DetectedLink = {
  raw: string;
  url: string | null;
  start: number;
  end: number;
  issue?: string;
};

const commonTopLevelDomain = /^(?:com|org|net|edu|gov|mil|int|io|co|uk|de|fr|es|it|nl|ca|us|au|nz|jp|cn|in|br|mx|ru|ch|se|no|fi|dk|be|at|ie|il|sa|ae|me|tv|ai|app|dev|info|biz|name|pro|xyz|online|site|tech|store|cloud|museum|travel|mobi|link|click|top|work|world|live|news|blog|website|email|company|services|social|academy|solutions|support|design|shop|finance|bank|zip)$/i;
const fileLikeSuffix = /^(?:pdf|docx?|pptx?|xlsx?|csv|txt|rtf|odt|ods|odp|zip|7z|rar|tar|gz|bz2|xz|exe|dll|msi|apk|dmg|iso|bin|dat|json|xml|ya?ml|html?|css|m?js|cjs|tsx?|jsx?|py|java|c|h|cpp|cs|go|rs|php|rb|sh|ps1|bat|cmd|jpe?g|png|gif|webp|svg|mp3|wav|ogg|mp4|mov|avi|mkv|webm|m4a|woff2?|ttf|otf|sqlite|db|bak|log|eml|msg)$/i;
const linkPattern = /(?:https?:\/\/|hxxps?:\/\/|www\.)[^\s<>"'`]+|(?<![\p{L}\d@._-])(?:[\p{L}\d-]+(?:(?:\.|\[\.\]|\(dot\)|\[dot\])[\p{L}\d-]+)*(?:\.|\[\.\]|\(dot\)|\[dot\])[\p{L}]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?/giu;
const trailingPunctuation = /[.,;:!?)}\]]+$/;

function normalizeLink(raw: string) {
  const withoutPunctuation = raw.replace(trailingPunctuation, "");
  const defanged = withoutPunctuation
    .replace(/\[\s*\.\s*\]|\(\s*\.\s*\)|\[\s*dot\s*\]|\(\s*dot\s*\)/gi, ".")
    .replace(/^hxxps:/i, "https:")
    .replace(/^hxxp:/i, "http:");
  const withScheme = /^www\./i.test(defanged) ? `https://${defanged}` : defanged.includes("://")
    ? defanged
    : `https://${defanged}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { url: null, issue: "This link has an invalid or deceptive format." };
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    return { url: null, issue: "Links with deceptive credentials or unsupported schemes are blocked." };
  }
  const topLevelDomain = url.hostname.split(".").at(-1) ?? "";
  if (
    !commonTopLevelDomain.test(topLevelDomain) &&
    !topLevelDomain.startsWith("xn--")
  ) {
    return { url: null, issue: "This link uses an unrecognized domain ending and cannot be verified." };
  }
  url.hash = "";
  return { url: url.href };
}

export function extractLinks(text: string): DetectedLink[] {
  const links: DetectedLink[] = [];
  for (const match of text.matchAll(linkPattern)) {
    const raw = match[0].replace(trailingPunctuation, "");
    if (!raw) continue;
    if (
      !/^(?:https?:\/\/|hxxps?:\/\/|www\.)/i.test(raw) &&
      fileLikeSuffix.test(raw.split(/[./()[\]]/).at(-1) ?? "") &&
      !commonTopLevelDomain.test(raw.split(/[./()[\]]/).at(-2) ?? "")
    ) {
      continue;
    }
    const start = match.index ?? 0;
    const normalized = normalizeLink(raw);
    const previous = links.at(-1);
    if (previous && start < previous.end) continue;
    links.push({
      raw,
      url: normalized.url,
      start,
      end: start + raw.length,
      ...(normalized.issue ? { issue: normalized.issue } : {}),
    });
  }
  return links;
}

export function youtubeEmbedUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;

  const hostname = url.hostname.toLowerCase();
  const youtubeHosts = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
  ]);
  if (!youtubeHosts.has(hostname)) return null;

  const videoId = hostname === "youtu.be"
    ? url.pathname.split("/").filter(Boolean)[0]
    : url.pathname === "/watch"
      ? url.searchParams.get("v")
      : url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1];
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;

  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

export function isPublicReputationUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hostname.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) ||
    !url.hostname.includes(".")
  ) {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  return ![
    "localhost",
    ".localhost",
    ".local",
    ".internal",
    ".test",
    ".invalid",
    ".example",
  ].some((suffix) => hostname === suffix || hostname.endsWith(suffix));
}

export const maxLinksPerMessage = 10;

export function uniqueReputationUrls(links: DetectedLink[]) {
  return [...new Set(links.flatMap((link) =>
    link.url && isPublicReputationUrl(link.url) ? [link.url] : [],
  ))];
}

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

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
  const hostParts = url.hostname.split(".");
  const topLevelDomain = hostParts[hostParts.length - 1] ?? "";
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
    const rawParts = raw.split(/[./()[\]]/);
    if (
      !/^(?:https?:\/\/|hxxps?:\/\/|www\.)/i.test(raw) &&
      fileLikeSuffix.test(rawParts[rawParts.length - 1] ?? "") &&
      !commonTopLevelDomain.test(rawParts[rawParts.length - 2] ?? "")
    ) {
      continue;
    }
    const start = match.index ?? 0;
    const normalized = normalizeLink(raw);
    const previous = links[links.length - 1];
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

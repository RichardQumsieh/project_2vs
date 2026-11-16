export type BraveSearchSource = {
  title: string;
  url: string;
  excerpt: string;
};

const maxResults = 4;
const maxExcerptLength = 1_200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function extractBraveSources(payload: unknown): BraveSearchSource[] | null {
  if (!isRecord(payload) || !isRecord(payload.web) || !Array.isArray(payload.web.results)) {
    return null;
  }

  const sources = payload.web.results
    .slice(0, maxResults * 2)
    .flatMap((item: unknown) => {
      if (
        !isRecord(item) ||
        typeof item.title !== "string" ||
        typeof item.url !== "string" ||
        typeof item.description !== "string"
      ) {
        return [];
      }

      let url: URL;
      try {
        url = new URL(item.url);
      } catch {
        return [];
      }
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
        return [];
      }

      const title = item.title.trim().slice(0, 200);
      const excerpt = item.description
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxExcerptLength);
      return title && excerpt ? [{ title, url: url.href, excerpt }] : [];
    });

  return sources.slice(0, maxResults);
}

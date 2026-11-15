import { api } from "../api";

export type ResearchSource = {
  title: string;
  url: string;
  excerpt: string;
};

const maxSearchQueryLength = 300;
const maxSources = 4;
const maxExcerptLength = 1_200;

const researchIntent =
  /\b(search|research|look up|find sources|cite|citations?|evidence|latest|current|today|recent|verify|fact[ -]?check|scientific|studies|sources?)\b|ابحث|بحث|مصادر|مصدر|أدلة|دليل|أبحاث|حديث|حالي/i;
const factualQuestion =
  /^(who|what|when|where|why|how|is|are|does|do|can|will|which|هل|ما|ماذا|من|متى|أين|اين|لماذا|كيف)\b/i;
const conversationalContext =
  /\b(he|she|they|my friend|my partner|my contact|our conversation|this chat|what should i|should i|should i tell|reply to|respond to)\b|صديقي|صديقتي|شريكي|شريكتي|ماذا أرد|ماذا اقول|ماذا أفعل|ماذا افعل|هل أقول|هل اقول|أرد عليه|أرد عليها/i;
const privateMaterial =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|https?:\/\/\S+|\+?\d[\d\s().-]{7,}\d/i;

export function getAutomaticResearchQuery(input: string): string | null {
  const prompt = input.trim();
  if (
    !prompt ||
    prompt.length > 2_000 ||
    privateMaterial.test(prompt) ||
    conversationalContext.test(prompt) ||
    (!researchIntent.test(prompt) && !factualQuestion.test(prompt))
  ) {
    return null;
  }

  const query = prompt
    .replace(/^(please\s+)?(can you\s+)?(search|research|look up)\s+(the web\s+)?(for\s+)?/i, "")
    .replace(/^(من فضلك\s+)?(ابحث|ابحثي)\s+(عن\s+)?/i, "")
    .trim();
  if (!query || query.length > maxSearchQueryLength) {
    return null;
  }
  return query;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSources(value: unknown): ResearchSource[] {
  if (!isRecord(value) || !Array.isArray(value.sources)) {
    throw new Error("The research provider returned an unsupported response.");
  }

  return value.sources
    .filter(isRecord)
    .flatMap((page) => {
      if (
        typeof page.title !== "string" ||
        typeof page.url !== "string" ||
        typeof page.excerpt !== "string"
      ) {
        return [];
      }

      let url: URL;
      try {
        url = new URL(page.url);
      } catch {
        return [];
      }
      if (
        url.protocol !== "https:" ||
        !url.hostname ||
        url.username ||
        url.password
      ) {
        return [];
      }

      const excerpt = page.excerpt
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxExcerptLength);
      return excerpt ? [{ title: page.title.slice(0, 200), url: url.href, excerpt }] : [];
    })
    .slice(0, maxSources);
}

export async function searchWeb(
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<ResearchSource[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > maxSearchQueryLength) {
    throw new Error("Research queries must contain 1 to 300 characters.");
  }
  if (options.signal?.aborted) {
    throw new DOMException("Research cancelled", "AbortError");
  }

  const response = await api.researchSearch(normalizedQuery, options.signal);
  const sources = parseSources(response);
  if (!sources.length) {
    throw new Error("No useful public sources were found for that question.");
  }
  return sources;
}

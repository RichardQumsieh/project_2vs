export type MemoryFact = {
  id: string;
  text: string;
  createdAt: string;
};

const storagePrefix = "private-messenger:sophia-memory:";
const legacyStoragePrefix = "private-messenger:jarvis-memory:";
export const maxMemoryFacts = 80;
export const maxMemoryFactCharacters = 240;

function storageKey(userId: string) {
  return `${storagePrefix}${userId}`;
}

function legacyStorageKey(userId: string) {
  return `${legacyStoragePrefix}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeMemoryFact(text: string) {
  return text.replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
}

export function parseMemoryFacts(value: unknown): MemoryFact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const facts: MemoryFact[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const text = typeof item.text === "string" ? normalizeMemoryFact(item.text) : "";
    if (
      !text ||
      text.length > maxMemoryFactCharacters ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 80 ||
      typeof item.createdAt !== "string"
    ) {
      continue;
    }
    facts.push({
      id: item.id,
      text,
      createdAt: item.createdAt,
    });
    if (facts.length >= maxMemoryFacts) {
      break;
    }
  }
  return facts;
}

export function loadPersonalMemory(userId: string): MemoryFact[] {
  if (!userId || typeof window === "undefined") {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(storageKey(userId));
    if (stored) {
      return parseMemoryFacts(JSON.parse(stored));
    }
    const legacy = window.localStorage.getItem(legacyStorageKey(userId));
    if (!legacy) {
      return [];
    }
    const migrated = parseMemoryFacts(JSON.parse(legacy));
    window.localStorage.setItem(storageKey(userId), JSON.stringify(migrated));
    window.localStorage.removeItem(legacyStorageKey(userId));
    return migrated;
  } catch {
    return [];
  }
}

export function savePersonalMemory(userId: string, facts: MemoryFact[]) {
  if (!userId) {
    return false;
  }
  try {
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify(parseMemoryFacts(facts)),
    );
    window.localStorage.removeItem(legacyStorageKey(userId));
    return true;
  } catch {
    return false;
  }
}

export function addMemoryFact(
  facts: MemoryFact[],
  text: string,
  options: { id?: string; createdAt?: string } = {},
): MemoryFact[] {
  const normalized = normalizeMemoryFact(text);
  if (!normalized || normalized.length > maxMemoryFactCharacters) {
    throw new Error("Personal notes must contain 1 to 240 characters.");
  }
  const duplicate = facts.some(
    (fact) => fact.text.toLowerCase() === normalized.toLowerCase(),
  );
  if (duplicate) {
    return facts;
  }
  return parseMemoryFacts([
    {
      id: options.id ?? crypto.randomUUID(),
      text: normalized,
      createdAt: options.createdAt ?? new Date().toISOString(),
    },
    ...facts,
  ]);
}

export function removeMemoryFact(
  facts: MemoryFact[],
  query: { id?: string; text?: string },
): MemoryFact[] {
  const needle = query.text ? normalizeMemoryFact(query.text).toLowerCase() : "";
  return facts.filter((fact) => {
    if (query.id && fact.id === query.id) {
      return false;
    }
    if (needle && fact.text.toLowerCase().includes(needle)) {
      return false;
    }
    return true;
  });
}

export function formatMemoryForPrompt(facts: MemoryFact[], limit = 8) {
  return facts.slice(0, limit).map((fact) =>
    JSON.stringify(fact.text.slice(0, maxMemoryFactCharacters))
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e"),
  );
}

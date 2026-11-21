export type DirectoryPerson = {
  id: string;
  username: string;
  displayName: string | null;
};

/** "@benjoe" and "  Ben   Joe  " become comparable needles. */
export function normalizePersonQuery(raw: string): string {
  return raw.trim().replace(/^@+/, "").replace(/\s+/g, " ").slice(0, 80);
}

export function personLikePattern(raw: string): string | null {
  const needle = normalizePersonQuery(raw).toLowerCase();
  if (needle.length < 2) return null;
  const escaped = needle.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

/** Lower rank is a closer match. null means the person does not match. */
export function personMatchRank(person: DirectoryPerson, raw: string): number | null {
  const query = normalizePersonQuery(raw).toLowerCase();
  if (query.length < 2) return null;
  const username = person.username.toLowerCase();
  const name = (person.displayName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (username === query) return 0;
  if (name === query) return 1;
  if (username.startsWith(query)) return 2;
  if (name.startsWith(query)) return 3;
  if (username.includes(query)) return 4;
  if (name.includes(query)) return 5;
  return null;
}

export function rankPeople<T extends DirectoryPerson>(people: T[], raw: string): T[] {
  return people
    .map((person) => ({ person, rank: personMatchRank(person, raw) }))
    .filter((row): row is { person: T; rank: number } => row.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.person.username.localeCompare(right.person.username))
    .map((row) => row.person);
}

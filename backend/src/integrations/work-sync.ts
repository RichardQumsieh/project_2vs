import type { WorkProviderId } from "./work-providers.js";

export type NormalizedWorkItem = {
  externalItemId: string;
  kind: "ISSUE" | "PULL_REQUEST";
  number: number | null;
  title: string;
  state: string;
  url: string;
  containerKey: string;
  updatedAtExternal: Date | null;
};

function clampTitle(value: unknown) {
  if (typeof value !== "string") {
    return "(untitled)";
  }
  const cleaned = value.replace(/\u0000/g, "").trim().slice(0, 200);
  return cleaned || "(untitled)";
}

function clampState(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "unknown";
  }
  return value.replace(/\u0000/g, "").trim().slice(0, 64);
}

function clampUrl(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\u0000/g, "").trim().slice(0, 500);
}

function parseExternalDate(value: unknown) {
  if (typeof value !== "string" || !value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

export function normalizeGitHubWorkItems(payload: unknown): NormalizedWorkItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  const items: NormalizedWorkItem[] = [];
  for (const item of payload.slice(0, 100)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "number" && typeof row.id !== "string") {
      continue;
    }
    const url = clampUrl(row.html_url);
    if (!url) {
      continue;
    }
    const repository =
      typeof row.repository === "object" && row.repository !== null
        ? (row.repository as { full_name?: unknown })
        : null;
    const containerKey =
      typeof repository?.full_name === "string"
        ? repository.full_name.slice(0, 200)
        : "";
    const number =
      typeof row.number === "number" && Number.isFinite(row.number)
        ? Math.trunc(row.number)
        : null;
    items.push({
      externalItemId: String(row.id).slice(0, 200),
      kind: row.pull_request ? "PULL_REQUEST" : "ISSUE",
      number,
      title: clampTitle(row.title),
      state: clampState(row.state),
      url,
      containerKey,
      updatedAtExternal: parseExternalDate(row.updated_at),
    });
  }
  return items;
}

export function normalizeLinearWorkItems(payload: unknown): NormalizedWorkItem[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    return [];
  }
  const issues = (data as { issues?: unknown }).issues;
  if (typeof issues !== "object" || issues === null) {
    return [];
  }
  const nodes = (issues as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) {
    return [];
  }
  const items: NormalizedWorkItem[] = [];
  for (const item of nodes.slice(0, 100)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) {
      continue;
    }
    const url = clampUrl(row.url);
    if (!url) {
      continue;
    }
    const stateObj =
      typeof row.state === "object" && row.state !== null
        ? (row.state as { name?: unknown; type?: unknown })
        : null;
    const teamObj =
      typeof row.team === "object" && row.team !== null
        ? (row.team as { key?: unknown })
        : null;
    const identifier =
      typeof row.identifier === "string" ? row.identifier : null;
    const numberMatch = identifier?.match(/(\d+)\s*$/);
    const number = numberMatch ? Number.parseInt(numberMatch[1]!, 10) : null;
    items.push({
      externalItemId: row.id.slice(0, 200),
      kind: "ISSUE",
      number: Number.isFinite(number) ? number : null,
      title: clampTitle(row.title),
      state: clampState(stateObj?.name ?? stateObj?.type),
      url,
      containerKey:
        typeof teamObj?.key === "string" ? teamObj.key.slice(0, 200) : "",
      updatedAtExternal: parseExternalDate(row.updatedAt),
    });
  }
  return items;
}

export function normalizeWorkItemsForProvider(
  provider: WorkProviderId,
  payload: unknown,
) {
  return provider === "github"
    ? normalizeGitHubWorkItems(payload)
    : normalizeLinearWorkItems(payload);
}

export const LINEAR_ASSIGNED_ISSUES_QUERY = `
query AssignedIssues {
  issues(
    filter: { assignee: { isMe: { eq: true } } }
    first: 50
    orderBy: updatedAt
  ) {
    nodes {
      id
      identifier
      title
      url
      updatedAt
      state { name type }
      team { key }
    }
  }
}
`.trim();

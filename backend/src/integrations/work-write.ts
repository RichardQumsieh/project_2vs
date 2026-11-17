import { LINEAR_GRAPHQL_URL } from "./work-providers.js";

export type GitHubIssueWritePayload = {
  owner: string;
  repo: string;
  title: string;
  body?: string;
};

export type GitHubIssueUpdatePayload = {
  owner: string;
  repo: string;
  issueNumber: number;
  title?: string;
  body?: string;
  state?: "open" | "closed";
};

export type GitHubCommentWritePayload = {
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
};

export type LinearIssueWritePayload = {
  title: string;
  teamId: string;
  description?: string;
};

export type LinearIssueUpdatePayload = {
  issueId: string;
  title?: string;
  description?: string;
};

function clampText(value: string, max: number) {
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

function parseRepoRef(owner: unknown, repo: unknown) {
  if (typeof owner !== "string" || !/^[A-Za-z0-9_.-]+$/.test(owner)) {
    return { ok: false as const, error: "owner is invalid" };
  }
  if (typeof repo !== "string" || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return { ok: false as const, error: "repo is invalid" };
  }
  return {
    ok: true as const,
    owner: owner.slice(0, 100),
    repo: repo.slice(0, 100),
  };
}

export function validateGitHubIssueWritePayload(body: unknown) {
  if (typeof body !== "object" || body === null) {
    return { ok: false as const, error: "Invalid payload" };
  }
  const row = body as Record<string, unknown>;
  const ref = parseRepoRef(row.owner, row.repo);
  if (!ref.ok) {
    return ref;
  }
  if (typeof row.title !== "string" || !row.title.trim()) {
    return { ok: false as const, error: "title is required" };
  }
  return {
    ok: true as const,
    payload: {
      owner: ref.owner,
      repo: ref.repo,
      title: clampText(row.title, 256),
      body:
        typeof row.body === "string" ? clampText(row.body, 20_000) : undefined,
    } satisfies GitHubIssueWritePayload,
  };
}

export function validateGitHubIssueUpdatePayload(body: unknown) {
  if (typeof body !== "object" || body === null) {
    return { ok: false as const, error: "Invalid payload" };
  }
  const row = body as Record<string, unknown>;
  const ref = parseRepoRef(row.owner, row.repo);
  if (!ref.ok) {
    return ref;
  }
  if (
    typeof row.issueNumber !== "number" ||
    !Number.isInteger(row.issueNumber) ||
    row.issueNumber < 1
  ) {
    return { ok: false as const, error: "issueNumber is required" };
  }
  if (
    row.title === undefined &&
    row.body === undefined &&
    row.state === undefined
  ) {
    return { ok: false as const, error: "At least one field to update is required" };
  }
  if (
    row.state !== undefined &&
    row.state !== "open" &&
    row.state !== "closed"
  ) {
    return { ok: false as const, error: "state must be open or closed" };
  }
  return {
    ok: true as const,
    payload: {
      owner: ref.owner,
      repo: ref.repo,
      issueNumber: row.issueNumber,
      title:
        typeof row.title === "string" ? clampText(row.title, 256) : undefined,
      body:
        typeof row.body === "string" ? clampText(row.body, 20_000) : undefined,
      state: row.state as "open" | "closed" | undefined,
    } satisfies GitHubIssueUpdatePayload,
  };
}

export function validateGitHubCommentWritePayload(body: unknown) {
  if (typeof body !== "object" || body === null) {
    return { ok: false as const, error: "Invalid payload" };
  }
  const row = body as Record<string, unknown>;
  const ref = parseRepoRef(row.owner, row.repo);
  if (!ref.ok) {
    return ref;
  }
  if (
    typeof row.issueNumber !== "number" ||
    !Number.isInteger(row.issueNumber) ||
    row.issueNumber < 1
  ) {
    return { ok: false as const, error: "issueNumber is required" };
  }
  if (typeof row.body !== "string" || !row.body.trim()) {
    return { ok: false as const, error: "body is required" };
  }
  return {
    ok: true as const,
    payload: {
      owner: ref.owner,
      repo: ref.repo,
      issueNumber: row.issueNumber,
      body: clampText(row.body, 20_000),
    } satisfies GitHubCommentWritePayload,
  };
}

export function validateLinearIssueWritePayload(body: unknown) {
  if (typeof body !== "object" || body === null) {
    return { ok: false as const, error: "Invalid payload" };
  }
  const row = body as Record<string, unknown>;
  if (typeof row.title !== "string" || !row.title.trim()) {
    return { ok: false as const, error: "title is required" };
  }
  if (typeof row.teamId !== "string" || !row.teamId.trim()) {
    return { ok: false as const, error: "teamId is required" };
  }
  return {
    ok: true as const,
    payload: {
      title: clampText(row.title, 256),
      teamId: clampText(row.teamId, 64),
      description:
        typeof row.description === "string"
          ? clampText(row.description, 20_000)
          : undefined,
    } satisfies LinearIssueWritePayload,
  };
}

export function validateLinearIssueUpdatePayload(body: unknown) {
  if (typeof body !== "object" || body === null) {
    return { ok: false as const, error: "Invalid payload" };
  }
  const row = body as Record<string, unknown>;
  if (typeof row.issueId !== "string" || !row.issueId.trim()) {
    return { ok: false as const, error: "issueId is required" };
  }
  if (row.title === undefined && row.description === undefined) {
    return { ok: false as const, error: "At least one field to update is required" };
  }
  return {
    ok: true as const,
    payload: {
      issueId: clampText(row.issueId, 64),
      title:
        typeof row.title === "string" ? clampText(row.title, 256) : undefined,
      description:
        typeof row.description === "string"
          ? clampText(row.description, 20_000)
          : undefined,
    } satisfies LinearIssueUpdatePayload,
  };
}

export function buildGitHubIssueCreateRequest(payload: GitHubIssueWritePayload) {
  return {
    url: `https://api.github.com/repos/${payload.owner}/${payload.repo}/issues`,
    method: "POST" as const,
    body: {
      title: payload.title,
      body: payload.body,
    },
  };
}

export function buildGitHubIssueUpdateRequest(payload: GitHubIssueUpdatePayload) {
  return {
    url: `https://api.github.com/repos/${payload.owner}/${payload.repo}/issues/${payload.issueNumber}`,
    method: "PATCH" as const,
    body: {
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.body !== undefined ? { body: payload.body } : {}),
      ...(payload.state !== undefined ? { state: payload.state } : {}),
    },
  };
}

export function buildGitHubCommentCreateRequest(
  payload: GitHubCommentWritePayload,
) {
  // Issue comments endpoint also works for pull requests.
  return {
    url: `https://api.github.com/repos/${payload.owner}/${payload.repo}/issues/${payload.issueNumber}/comments`,
    method: "POST" as const,
    body: { body: payload.body },
  };
}

export const LINEAR_ISSUE_CREATE_MUTATION = `
mutation IssueCreate($title: String!, $teamId: String!, $description: String) {
  issueCreate(input: { title: $title, teamId: $teamId, description: $description }) {
    success
    issue { id identifier url }
  }
}
`.trim();

export const LINEAR_ISSUE_UPDATE_MUTATION = `
mutation IssueUpdate($id: String!, $title: String, $description: String) {
  issueUpdate(id: $id, input: { title: $title, description: $description }) {
    success
    issue { id identifier url }
  }
}
`.trim();

export function buildLinearIssueCreateRequest(payload: LinearIssueWritePayload) {
  return {
    url: LINEAR_GRAPHQL_URL,
    method: "POST" as const,
    body: {
      query: LINEAR_ISSUE_CREATE_MUTATION,
      variables: {
        title: payload.title,
        teamId: payload.teamId,
        description: payload.description,
      },
    },
  };
}

export function buildLinearIssueUpdateRequest(payload: LinearIssueUpdatePayload) {
  return {
    url: LINEAR_GRAPHQL_URL,
    method: "POST" as const,
    body: {
      query: LINEAR_ISSUE_UPDATE_MUTATION,
      variables: {
        id: payload.issueId,
        title: payload.title,
        description: payload.description,
      },
    },
  };
}

export function parseGitHubIssueResult(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.html_url !== "string" || typeof row.number !== "number") {
    return null;
  }
  return {
    number: row.number,
    url: row.html_url.slice(0, 500),
    id: typeof row.id === "number" ? String(row.id) : null,
  };
}

export function parseGitHubCommentResult(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.html_url !== "string" || typeof row.id !== "number") {
    return null;
  }
  return {
    id: String(row.id),
    url: row.html_url.slice(0, 500),
  };
}

export function parseLinearIssueMutationResult(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const create =
    (data as { issueCreate?: unknown; issueUpdate?: unknown }).issueCreate ??
    (data as { issueUpdate?: unknown }).issueUpdate;
  if (typeof create !== "object" || create === null) {
    return null;
  }
  const issue = (create as { issue?: unknown }).issue;
  if (typeof issue !== "object" || issue === null) {
    return null;
  }
  const row = issue as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.url !== "string") {
    return null;
  }
  return {
    id: row.id.slice(0, 64),
    identifier:
      typeof row.identifier === "string" ? row.identifier.slice(0, 32) : null,
    url: row.url.slice(0, 500),
  };
}

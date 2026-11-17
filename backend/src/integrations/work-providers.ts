export type WorkProviderId = "github" | "linear";

export type WorkProviderConfig = {
  id: WorkProviderId;
  prismaProvider: "GITHUB" | "LINEAR";
  label: string;
  /** Work OAuth scopes (read mirrors + write issues as of Phase 4.2). */
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
};

export const workProviders: Record<WorkProviderId, WorkProviderConfig> = {
  github: {
    id: "github",
    prismaProvider: "GITHUB",
    label: "GitHub",
    // `repo` already covers issue/PR create + comments (write-capable).
    scopes: ["read:user", "repo"],
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
  },
  linear: {
    id: "linear",
    prismaProvider: "LINEAR",
    label: "Linear",
    // `write` does not imply `read` on Linear — keep both.
    scopes: ["read", "write"],
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    revokeUrl: "https://api.linear.app/oauth/revoke",
  },
};

export function parseWorkProvider(value: string): WorkProviderId | null {
  if (value === "github" || value === "linear") {
    return value;
  }
  return null;
}

export const GITHUB_ASSIGNED_ISSUES_URL =
  "https://api.github.com/issues?filter=assigned&state=open&per_page=50";

export const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

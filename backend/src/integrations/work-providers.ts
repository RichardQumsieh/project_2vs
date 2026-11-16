export type WorkProviderId = "github" | "linear";

export type WorkProviderConfig = {
  id: WorkProviderId;
  prismaProvider: "GITHUB" | "LINEAR";
  label: string;
  /** Minimum scopes for assigned issue/PR metadata read. */
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
    // GitHub OAuth Apps have no classic read-only private-repo scope.
    // `repo` is the documented minimum for private assigned issues/PRs.
    scopes: ["read:user", "repo"],
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
  },
  linear: {
    id: "linear",
    prismaProvider: "LINEAR",
    label: "Linear",
    scopes: ["read"],
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

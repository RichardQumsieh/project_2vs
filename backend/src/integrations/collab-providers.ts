export type CollabProviderId = "slack";

export type CollabProviderConfig = {
  id: CollabProviderId;
  prismaProvider: "SLACK";
  label: string;
  /** Minimum user scopes for channel name listing (no message history). */
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
};

export const collabProviders: Record<CollabProviderId, CollabProviderConfig> = {
  slack: {
    id: "slack",
    prismaProvider: "SLACK",
    label: "Slack",
    // User token scopes: channel metadata only — no channels:history / chat:write.
    scopes: ["channels:read", "groups:read", "users:read"],
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    revokeUrl: "https://slack.com/api/auth.revoke",
  },
};

export function parseCollabProvider(value: string): CollabProviderId | null {
  if (value === "slack") {
    return value;
  }
  return null;
}

export const SLACK_CONVERSATIONS_LIST_URL =
  "https://slack.com/api/conversations.list";

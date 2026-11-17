export type CollabProviderId = "slack";

export type CollabProviderConfig = {
  id: CollabProviderId;
  prismaProvider: "SLACK";
  label: string;
  /** Slack user scopes (channel list + chat:write; no channels:history). */
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
    // Channel metadata + post to chosen channel. No channels:history by default.
    scopes: ["channels:read", "groups:read", "users:read", "chat:write"],
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

import type { CollabProviderId } from "./collab-providers.js";

export type NormalizedCollabChannel = {
  externalChannelId: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
};

function clampName(value: unknown) {
  if (typeof value !== "string") {
    return "(unnamed)";
  }
  const cleaned = value.replace(/\u0000/g, "").trim().slice(0, 200);
  return cleaned || "(unnamed)";
}

export function normalizeSlackChannels(
  payload: unknown,
): NormalizedCollabChannel[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const channels = (payload as { channels?: unknown }).channels;
  if (!Array.isArray(channels)) {
    return [];
  }
  const items: NormalizedCollabChannel[] = [];
  for (const item of channels.slice(0, 200)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) {
      continue;
    }
    // Skip DMs / MPIMs — only public/private named channels for collab mirror.
    if (row.is_im === true || row.is_mpim === true) {
      continue;
    }
    items.push({
      externalChannelId: row.id.slice(0, 200),
      name: clampName(row.name),
      isPrivate: row.is_private === true || row.is_group === true,
      isArchived: row.is_archived === true,
    });
  }
  return items;
}

export function normalizeCollabChannelsForProvider(
  provider: CollabProviderId,
  payload: unknown,
) {
  return provider === "slack" ? normalizeSlackChannels(payload) : [];
}

import type { JobManagerDefaults } from "./sophia-job-tools";

const storagePrefix = "private-messenger:sophia-job-defaults:";

export function jobDefaultsStorageKey(userId: string) {
  return `${storagePrefix}${userId.trim()}`;
}

export function emptyJobDefaults(): JobManagerDefaults {
  return {};
}

export function parseJobDefaults(value: unknown): JobManagerDefaults {
  if (typeof value !== "object" || value === null) {
    return emptyJobDefaults();
  }
  const row = value as Record<string, unknown>;
  const next: JobManagerDefaults = {};
  if (row.calendarProvider === "google" || row.calendarProvider === "outlook") {
    next.calendarProvider = row.calendarProvider;
  }
  if (row.emailProvider === "gmail" || row.emailProvider === "outlook-mail") {
    next.emailProvider = row.emailProvider;
  }
  if (typeof row.githubOwner === "string" && /^[A-Za-z0-9_.-]+$/.test(row.githubOwner)) {
    next.githubOwner = row.githubOwner.slice(0, 80);
  }
  if (typeof row.githubRepo === "string" && /^[A-Za-z0-9_.-]+$/.test(row.githubRepo)) {
    next.githubRepo = row.githubRepo.slice(0, 80);
  }
  if (typeof row.linearTeamId === "string" && row.linearTeamId.trim()) {
    next.linearTeamId = row.linearTeamId.trim().slice(0, 64);
  }
  if (
    typeof row.slackChannelId === "string" &&
    /^[CGD][A-Z0-9]+$/i.test(row.slackChannelId)
  ) {
    next.slackChannelId = row.slackChannelId.trim().slice(0, 32);
  }
  if (typeof row.slackChannelName === "string" && row.slackChannelName.trim()) {
    next.slackChannelName = row.slackChannelName.trim().slice(0, 80);
  }
  return next;
}

export function loadJobDefaults(userId: string | null | undefined): JobManagerDefaults {
  if (!userId || typeof localStorage === "undefined") {
    return emptyJobDefaults();
  }
  try {
    const raw = localStorage.getItem(jobDefaultsStorageKey(userId));
    if (!raw) {
      return emptyJobDefaults();
    }
    return parseJobDefaults(JSON.parse(raw) as unknown);
  } catch {
    return emptyJobDefaults();
  }
}

export function saveJobDefaults(
  userId: string | null | undefined,
  defaults: JobManagerDefaults,
): boolean {
  if (!userId || typeof localStorage === "undefined") {
    return false;
  }
  try {
    localStorage.setItem(
      jobDefaultsStorageKey(userId),
      JSON.stringify(parseJobDefaults(defaults)),
    );
    return true;
  } catch {
    return false;
  }
}

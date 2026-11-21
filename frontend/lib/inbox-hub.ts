export const inboxHubs = ["chats", "assistant", "activity", "mail"] as const;

export type InboxHub = (typeof inboxHubs)[number];

export type InboxMailView = "agenda" | "email" | "event";

/** Bookmarks and notifications still use this path. */
export const LEGACY_ACTIVITY_PATH = "/settings/activity";

export function firstQueryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function parseInboxHub(value: string | null | undefined): InboxHub {
  if (value === "activity" || value === "mail" || value === "assistant") return value;
  return "chats";
}

export function parseInboxMailView(value: string | null | undefined): InboxMailView {
  if (value === "email" || value === "event" || value === "agenda") return value;
  return "agenda";
}

export function inboxHubHref(hub: InboxHub, view?: InboxMailView): string {
  if (hub === "assistant") return "/inbox?hub=assistant";
  if (hub === "activity") return "/inbox?hub=activity";
  if (hub === "mail") {
    if (view === "email" || view === "event") return `/inbox?hub=mail&view=${view}`;
    return "/inbox?hub=mail";
  }
  return "/inbox";
}

export function legacyActivityRedirect(): string {
  return inboxHubHref("activity");
}

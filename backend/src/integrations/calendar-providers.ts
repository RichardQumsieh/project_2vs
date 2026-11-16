export type CalendarProviderId = "google" | "outlook";

export type CalendarProviderConfig = {
  id: CalendarProviderId;
  prismaProvider: "GOOGLE_CALENDAR" | "OUTLOOK_CALENDAR";
  label: string;
  /** Minimum read-only calendar scopes. */
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
};

export const calendarProviders: Record<
  CalendarProviderId,
  CalendarProviderConfig
> = {
  google: {
    id: "google",
    prismaProvider: "GOOGLE_CALENDAR",
    label: "Google Calendar",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
  },
  outlook: {
    id: "outlook",
    prismaProvider: "OUTLOOK_CALENDAR",
    label: "Outlook Calendar",
    scopes: ["offline_access", "Calendars.Read", "User.Read"],
    authorizeUrl:
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  },
};

export function parseCalendarProvider(
  value: string,
): CalendarProviderId | null {
  if (value === "google" || value === "outlook") {
    return value;
  }
  return null;
}

export const GOOGLE_CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export const OUTLOOK_CALENDAR_EVENTS_URL =
  "https://graph.microsoft.com/v1.0/me/calendarView";

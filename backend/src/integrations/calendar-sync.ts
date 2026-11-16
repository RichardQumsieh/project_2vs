import {
  GOOGLE_CALENDAR_EVENTS_URL,
  OUTLOOK_CALENDAR_EVENTS_URL,
  type CalendarProviderId,
} from "./calendar-providers.js";

export type NormalizedCalendarEvent = {
  externalEventId: string;
  calendarId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  busy: boolean;
};

function clampTitle(value: unknown) {
  if (typeof value !== "string") {
    return "(untitled)";
  }
  const cleaned = value.replace(/\u0000/g, "").trim().slice(0, 200);
  return cleaned || "(untitled)";
}

function parseGoogleDate(value: { dateTime?: string; date?: string } | undefined) {
  if (!value) {
    return null;
  }
  if (typeof value.dateTime === "string") {
    const parsed = Date.parse(value.dateTime);
    return Number.isFinite(parsed)
      ? { at: new Date(parsed), allDay: false }
      : null;
  }
  if (typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
    const parsed = Date.parse(`${value.date}T00:00:00.000Z`);
    return Number.isFinite(parsed)
      ? { at: new Date(parsed), allDay: true }
      : null;
  }
  return null;
}

export function normalizeGoogleCalendarEvents(
  payload: unknown,
): NormalizedCalendarEvent[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return [];
  }
  const events: NormalizedCalendarEvent[] = [];
  for (const item of items.slice(0, 250)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) {
      continue;
    }
    const start = parseGoogleDate(
      row.start as { dateTime?: string; date?: string } | undefined,
    );
    const end = parseGoogleDate(
      row.end as { dateTime?: string; date?: string } | undefined,
    );
    if (!start || !end) {
      continue;
    }
    events.push({
      externalEventId: row.id.slice(0, 200),
      calendarId: "primary",
      title: clampTitle(row.summary),
      startsAt: start.at,
      endsAt: end.at,
      allDay: start.allDay || end.allDay,
      busy: row.transparency !== "transparent",
    });
  }
  return events;
}

export function normalizeOutlookCalendarEvents(
  payload: unknown,
): NormalizedCalendarEvent[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const items = (payload as { value?: unknown }).value;
  if (!Array.isArray(items)) {
    return [];
  }
  const events: NormalizedCalendarEvent[] = [];
  for (const item of items.slice(0, 250)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) {
      continue;
    }
    const startRaw =
      typeof row.start === "object" &&
      row.start !== null &&
      typeof (row.start as { dateTime?: unknown }).dateTime === "string"
        ? (row.start as { dateTime: string }).dateTime
        : null;
    const endRaw =
      typeof row.end === "object" &&
      row.end !== null &&
      typeof (row.end as { dateTime?: unknown }).dateTime === "string"
        ? (row.end as { dateTime: string }).dateTime
        : null;
    if (!startRaw || !endRaw) {
      continue;
    }
    const startsAt = Date.parse(startRaw);
    const endsAt = Date.parse(endRaw);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
      continue;
    }
    events.push({
      externalEventId: row.id.slice(0, 200),
      calendarId: "primary",
      title: clampTitle(row.subject),
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      allDay: row.isAllDay === true,
      busy: row.showAs !== "free",
    });
  }
  return events;
}

export function eventsUrlForProvider(
  provider: CalendarProviderId,
  window: { timeMin: Date; timeMax: Date },
) {
  if (provider === "google") {
    const url = new URL(GOOGLE_CALENDAR_EVENTS_URL);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("timeMin", window.timeMin.toISOString());
    url.searchParams.set("timeMax", window.timeMax.toISOString());
    return url;
  }
  const url = new URL(OUTLOOK_CALENDAR_EVENTS_URL);
  url.searchParams.set("startDateTime", window.timeMin.toISOString());
  url.searchParams.set("endDateTime", window.timeMax.toISOString());
  url.searchParams.set("$top", "250");
  url.searchParams.set("$orderby", "start/dateTime");
  url.searchParams.set(
    "$select",
    "id,subject,start,end,isAllDay,showAs",
  );
  return url;
}

export function normalizeEventsForProvider(
  provider: CalendarProviderId,
  payload: unknown,
) {
  return provider === "google"
    ? normalizeGoogleCalendarEvents(payload)
    : normalizeOutlookCalendarEvents(payload);
}

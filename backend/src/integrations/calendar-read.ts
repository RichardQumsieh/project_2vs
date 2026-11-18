import { clampPlainText, htmlToPlainText } from "./plain-text.js";

export type CalendarAttendee = {
  name: string;
  email: string;
  status: string;
};

export type CalendarEventDetail = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string;
  description: string;
  attendees: CalendarAttendee[];
  truncated: boolean;
};

function clampField(value: unknown, max: number) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

function asRecord(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function googleDate(value: unknown) {
  const row = asRecord(value);
  if (!row) {
    return null;
  }
  if (typeof row.dateTime === "string") {
    const parsed = Date.parse(row.dateTime);
    return Number.isFinite(parsed)
      ? { at: new Date(parsed).toISOString(), allDay: false }
      : null;
  }
  if (typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    const parsed = Date.parse(`${row.date}T00:00:00.000Z`);
    return Number.isFinite(parsed)
      ? { at: new Date(parsed).toISOString(), allDay: true }
      : null;
  }
  return null;
}

function outlookInstant(value: unknown, timeZone: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  const trimmed = value.trim();
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const zone = typeof timeZone === "string" ? timeZone.toUpperCase() : "UTC";
  const source = hasZone || zone !== "UTC" ? trimmed : `${trimmed.replace(/\.\d+$/, "")}Z`;
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function attendeesFrom(
  value: unknown,
  read: (row: Record<string, unknown>) => CalendarAttendee | null,
) {
  if (!Array.isArray(value)) {
    return [];
  }
  const people: CalendarAttendee[] = [];
  for (const item of value.slice(0, 40)) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const person = read(row);
    if (person && (person.email || person.name)) {
      people.push(person);
    }
  }
  return people;
}

export function parseGoogleCalendarEvent(
  payload: unknown,
): CalendarEventDetail | null {
  const row = asRecord(payload);
  if (!row) {
    return null;
  }
  const start = googleDate(row.start);
  const end = googleDate(row.end);
  const description = clampPlainText(clampField(row.description, 20_000), 8_000);
  return {
    title: clampField(row.summary, 200),
    startsAt: start?.at ?? "",
    endsAt: end?.at ?? "",
    allDay: Boolean(start?.allDay || end?.allDay),
    location: clampField(row.location, 500),
    description: description.text,
    truncated: description.truncated,
    attendees: attendeesFrom(row.attendees, (person) => ({
      name: clampField(person.displayName, 200),
      email: clampField(person.email, 320),
      status: clampField(person.responseStatus, 40),
    })),
  };
}

export function parseOutlookCalendarEvent(
  payload: unknown,
): CalendarEventDetail | null {
  const row = asRecord(payload);
  if (!row) {
    return null;
  }
  const start = asRecord(row.start);
  const end = asRecord(row.end);
  const location = asRecord(row.location);
  const body = asRecord(row.body);
  const content = typeof body?.content === "string" ? body.content : "";
  const description =
    (typeof body?.contentType === "string" ? body.contentType : "").toLowerCase() ===
    "html"
      ? htmlToPlainText(content, 8_000)
      : clampPlainText(content, 8_000);
  return {
    title: clampField(row.subject, 200),
    startsAt: outlookInstant(start?.dateTime, start?.timeZone),
    endsAt: outlookInstant(end?.dateTime, end?.timeZone),
    allDay: row.isAllDay === true,
    location: clampField(location?.displayName, 500),
    description: description.text,
    truncated: description.truncated,
    attendees: attendeesFrom(row.attendees, (person) => {
      const emailAddress = asRecord(person.emailAddress);
      const status = asRecord(person.status);
      return {
        name: clampField(emailAddress?.name, 200),
        email: clampField(emailAddress?.address, 320),
        status: clampField(status?.response, 40),
      };
    }),
  };
}

export function googleEventDetailUrl(calendarId: string, externalEventId: string) {
  const calendar = encodeURIComponent(calendarId || "primary");
  const id = encodeURIComponent(externalEventId);
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events/${id}`,
  );
  url.searchParams.set(
    "fields",
    "summary,description,location,start,end,attendees(email,displayName,responseStatus)",
  );
  return url.toString();
}

export function outlookEventDetailUrl(externalEventId: string) {
  const url = new URL(
    `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(externalEventId)}`,
  );
  url.searchParams.set(
    "$select",
    "subject,body,start,end,location,attendees,isAllDay",
  );
  return url.toString();
}

import type { CalendarProviderId } from "./calendar-providers.js";

export type CalendarEventWritePayload = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  /** Optional description from an already-approved structured form — never chat ciphertext. */
  description?: string;
};

export type CalendarEventWriteResult = {
  externalEventId: string;
  htmlLink: string | null;
};

function clampText(value: string, max: number) {
  return value.replace(/\u0000/g, "").trim().slice(0, max);
}

export function validateCalendarEventWritePayload(
  body: unknown,
):
  | { ok: true; payload: CalendarEventWritePayload }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid payload" };
  }
  const row = body as Record<string, unknown>;
  if (typeof row.title !== "string" || !row.title.trim()) {
    return { ok: false, error: "title is required" };
  }
  if (typeof row.startsAt !== "string" || !Number.isFinite(Date.parse(row.startsAt))) {
    return { ok: false, error: "startsAt must be an ISO datetime" };
  }
  if (typeof row.endsAt !== "string" || !Number.isFinite(Date.parse(row.endsAt))) {
    return { ok: false, error: "endsAt must be an ISO datetime" };
  }
  if (Date.parse(row.endsAt) < Date.parse(row.startsAt)) {
    return { ok: false, error: "endsAt must be after startsAt" };
  }
  const description =
    typeof row.description === "string"
      ? clampText(row.description, 4000)
      : undefined;
  return {
    ok: true,
    payload: {
      title: clampText(row.title, 200),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay === true,
      description: description || undefined,
    },
  };
}

function googleEventBody(payload: CalendarEventWritePayload) {
  if (payload.allDay) {
    const startDay = payload.startsAt.slice(0, 10);
    const endDay = payload.endsAt.slice(0, 10);
    return {
      summary: payload.title,
      description: payload.description,
      start: { date: startDay },
      end: { date: endDay },
    };
  }
  return {
    summary: payload.title,
    description: payload.description,
    start: { dateTime: payload.startsAt },
    end: { dateTime: payload.endsAt },
  };
}

function outlookEventBody(payload: CalendarEventWritePayload) {
  return {
    subject: payload.title,
    body: payload.description
      ? { contentType: "Text", content: payload.description }
      : undefined,
    start: {
      dateTime: payload.startsAt.replace(/\.\d{3}Z$/, "").replace(/Z$/, ""),
      timeZone: "UTC",
    },
    end: {
      dateTime: payload.endsAt.replace(/\.\d{3}Z$/, "").replace(/Z$/, ""),
      timeZone: "UTC",
    },
    isAllDay: payload.allDay === true,
  };
}

export function buildCalendarCreateRequest(
  provider: CalendarProviderId,
  payload: CalendarEventWritePayload,
) {
  if (provider === "google") {
    return {
      url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      method: "POST" as const,
      body: googleEventBody(payload),
    };
  }
  return {
    url: "https://graph.microsoft.com/v1.0/me/events",
    method: "POST" as const,
    body: outlookEventBody(payload),
  };
}

export function buildCalendarUpdateRequest(
  provider: CalendarProviderId,
  externalEventId: string,
  payload: CalendarEventWritePayload,
) {
  const id = encodeURIComponent(externalEventId);
  if (provider === "google") {
    return {
      url: `https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`,
      method: "PATCH" as const,
      body: googleEventBody(payload),
    };
  }
  return {
    url: `https://graph.microsoft.com/v1.0/me/events/${id}`,
    method: "PATCH" as const,
    body: outlookEventBody(payload),
  };
}

export function parseCalendarWriteResult(
  provider: CalendarProviderId,
  payload: unknown,
): CalendarEventWriteResult | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) {
    return null;
  }
  if (provider === "google") {
    return {
      externalEventId: row.id.slice(0, 200),
      htmlLink: typeof row.htmlLink === "string" ? row.htmlLink.slice(0, 500) : null,
    };
  }
  return {
    externalEventId: row.id.slice(0, 200),
    htmlLink:
      typeof row.webLink === "string" ? row.webLink.slice(0, 500) : null,
  };
}

import { describe, expect, it } from "vitest";
import {
  buildCalendarEventAction,
  buildEmailDraftAction,
  localDayRange,
  sortRecentMail,
  toDatetimeLocalValue,
  upcomingEvents,
} from "./inbox-activity";

describe("inbox activity ordering", () => {
  it("sorts mail newest first and breaks ties by id", () => {
    const sorted = sortRecentMail([
      { id: "b", receivedAt: "2026-11-01T00:00:00.000Z" },
      { id: "c", receivedAt: "2026-11-17T12:00:00.000Z" },
      { id: "a", receivedAt: "2026-11-17T12:00:00.000Z" },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("keeps upcoming and in-progress events, soonest first", () => {
    const now = Date.parse("2026-11-17T15:00:00.000Z");
    const sorted = upcomingEvents(
      [
        {
          id: "past",
          startsAt: "2026-11-17T08:00:00.000Z",
          endsAt: "2026-11-17T09:00:00.000Z",
        },
        {
          id: "later",
          startsAt: "2026-11-18T09:00:00.000Z",
          endsAt: "2026-11-18T10:00:00.000Z",
        },
        {
          id: "live",
          startsAt: "2026-11-17T14:00:00.000Z",
          endsAt: "2026-11-17T16:00:00.000Z",
        },
      ],
      now,
    );
    expect(sorted.map((item) => item.id)).toEqual(["live", "later"]);
  });
});

describe("inbox activity actions", () => {
  it("builds a draft email and refuses to invent a send", () => {
    const built = buildEmailDraftAction({
      provider: "gmail",
      to: "Ada <ada@example.com>, bob@example.com",
      cc: "cc@example.com",
      subject: "Notes",
      body: "See you then.",
    });
    expect(built.ok).toBe(false);

    const valid = buildEmailDraftAction({
      provider: "outlook-mail",
      to: "ada@example.com, bob@example.com",
      subject: "Notes",
      body: "See you then.",
    });
    expect(valid).toEqual({
      ok: true,
      warnings: [],
      action: {
        type: "draft_email",
        provider: "outlook-mail",
        to: ["ada@example.com", "bob@example.com"],
        subject: "Notes",
        body: "See you then.",
        contentType: "text/plain",
      },
    });
  });

  it("stages a real send with HTML and warns on domain typos", () => {
    const typo = buildEmailDraftAction({
      provider: "gmail",
      to: "ada@gmial.com",
      subject: "Notes",
      body: "See **you** then.",
      delivery: "send",
    });
    expect(typo.ok).toBe(true);
    if (typo.ok) {
      expect(typo.warnings[0]).toMatch(/gmail\.com/);
      expect(typo.action.delivery).toBe("send");
      expect(typo.action.body).toBe("See you then.");
      expect(typo.action.html).toContain("<strong>you</strong>");
      expect(typo.action.contentType).toBe("text/html");
    }
    expect(
      buildEmailDraftAction({
        provider: "gmail",
        to: "not-an-email",
        subject: "Notes",
        body: "Hello",
      }).ok,
    ).toBe(false);
  });

  it("builds a calendar event in ISO time and rejects an end before the start", () => {
    const built = buildCalendarEventAction({
      provider: "google",
      title: "Standup",
      startsAt: "2026-11-18T15:00:00.000Z",
      endsAt: "2026-11-18T15:30:00.000Z",
      allDay: false,
      description: "30m",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.action.type).toBe("create_calendar_event");
      expect(built.action.startsAt).toBe("2026-11-18T15:00:00.000Z");
    }
    expect(
      buildCalendarEventAction({
        provider: "outlook",
        title: "Nope",
        startsAt: "2026-11-18T16:00:00.000Z",
        endsAt: "2026-11-18T15:00:00.000Z",
        allDay: false,
      }).ok,
    ).toBe(false);
  });

  it("formats local datetimes and all-day ranges", () => {
    expect(toDatetimeLocalValue(new Date(2026, 0, 2, 9, 5))).toBe("2026-01-02T09:05");
    const range = localDayRange("2026-11-18", "2026-11-18");
    expect(range).not.toBeNull();
    expect(localDayRange("2026-11-19", "2026-11-18")).toBeNull();
  });
});

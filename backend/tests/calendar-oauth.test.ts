import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeGoogleCalendarEvents,
  normalizeOutlookCalendarEvents,
} from "../src/integrations/calendar-sync.js";
import { createOAuthState, parseOAuthState } from "../src/integrations/oauth-state.js";
import { calendarProviders } from "../src/integrations/calendar-providers.js";

describe("calendar OAuth helpers", () => {
  it("uses minimum read-only calendar scopes", () => {
    assert.deepEqual(calendarProviders.google.scopes, [
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
    assert.ok(calendarProviders.outlook.scopes.includes("Calendars.Read"));
    assert.ok(!calendarProviders.google.scopes.some((scope) => /mail/i.test(scope)));
  });

  it("round-trips signed OAuth state and rejects tampering/expiry", () => {
    const secret = "test-oauth-state-secret-at-least-32-chars";
    const now = new Date("2026-11-15T12:00:00.000Z");
    const state = createOAuthState(
      {
        userId: "user-a",
        provider: "google",
        nonce: "abc123",
        now,
      },
      secret,
    );
    assert.deepEqual(parseOAuthState(state, secret, now), {
      userId: "user-a",
      provider: "google",
      nonce: "abc123",
      exp: now.getTime() + 10 * 60 * 1000,
    });
    assert.equal(parseOAuthState(`${state}x`, secret, now), null);
    assert.equal(
      parseOAuthState(state, secret, new Date(now.getTime() + 11 * 60 * 1000)),
      null,
    );
  });

  it("normalizes provider payloads without keeping description bodies", () => {
    const google = normalizeGoogleCalendarEvents({
      items: [
        {
          id: "evt-1",
          summary: "Ship review",
          description: "secret notes must not be required",
          start: { dateTime: "2026-11-16T15:00:00.000Z" },
          end: { dateTime: "2026-11-16T16:00:00.000Z" },
        },
      ],
    });
    assert.equal(google.length, 1);
    assert.equal(google[0]?.title, "Ship review");
    assert.equal(
      Object.prototype.hasOwnProperty.call(google[0], "description"),
      false,
    );

    const outlook = normalizeOutlookCalendarEvents({
      value: [
        {
          id: "evt-2",
          subject: "Customer call",
          body: { content: "should be ignored" },
          start: { dateTime: "2026-11-17T10:00:00.000Z" },
          end: { dateTime: "2026-11-17T10:30:00.000Z" },
          isAllDay: false,
          showAs: "busy",
        },
      ],
    });
    assert.equal(outlook[0]?.title, "Customer call");
    assert.equal(
      Object.prototype.hasOwnProperty.call(outlook[0], "body"),
      false,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarProviders } from "../src/integrations/calendar-providers.js";
import {
  googleEventDetailUrl,
  outlookEventDetailUrl,
  parseGoogleCalendarEvent,
  parseOutlookCalendarEvent,
} from "../src/integrations/calendar-read.js";
import {
  buildCalendarDeleteRequest,
  calendarDeleteAccepted,
} from "../src/integrations/calendar-write.js";
import { emailProviders } from "../src/integrations/email-providers.js";
import {
  gmailMessageBodyUrl,
  outlookMessageBodyUrl,
  parseGmailMessageBody,
  parseOutlookMessageBody,
} from "../src/integrations/email-read.js";
import {
  gateIntegrationRead,
  integrationReadLog,
  isMirrorId,
  readRequiredScopes,
} from "../src/integrations/read-gate.js";

const secret = "secret-body-token-9f3a";
const mirrorId = "11111111-1111-4111-8111-111111111111";

function b64url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("integration read authz", () => {
  it("returns 404 for another user's record and for a missing record", () => {
    const other = gateIntegrationRead({
      ownerUserId: "owner-a",
      sessionUserId: "attacker-b",
      status: "CONNECTED",
      grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      requiredReadScopes: readRequiredScopes.gmail,
    });
    assert.equal(other.ok, false);
    if (!other.ok) {
      assert.equal(other.status, 404);
      assert.equal(other.error, "Not found");
    }

    const missing = gateIntegrationRead({
      ownerUserId: null,
      sessionUserId: "owner-a",
      status: "CONNECTED",
      grantedScopes: ["gmail.readonly"],
      requiredReadScopes: readRequiredScopes.gmail,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.status, 404);
    }
    assert.equal(isMirrorId("../other-user"), false);
    assert.equal(isMirrorId(mirrorId), true);
  });

  it("allows the owner to read with existing scopes and refuses a disconnected account", () => {
    const read = gateIntegrationRead({
      ownerUserId: "owner-a",
      sessionUserId: "owner-a",
      status: "CONNECTED",
      grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      requiredReadScopes: readRequiredScopes.gmail,
    });
    assert.equal(read.ok, true);

    const calendar = gateIntegrationRead({
      ownerUserId: "owner-a",
      sessionUserId: "owner-a",
      status: "CONNECTED",
      grantedScopes: ["https://www.googleapis.com/auth/calendar.events"],
      requiredReadScopes: readRequiredScopes.googleCalendar,
    });
    assert.equal(calendar.ok, true);

    const outlook = gateIntegrationRead({
      ownerUserId: "owner-a",
      sessionUserId: "owner-a",
      status: "CONNECTED",
      grantedScopes: ["Mail.ReadWrite", "Mail.Send"],
      requiredReadScopes: readRequiredScopes.outlookMail,
    });
    assert.equal(outlook.ok, true);

    const disconnected = gateIntegrationRead({
      ownerUserId: "owner-a",
      sessionUserId: "owner-a",
      status: "REVOKED",
      grantedScopes: ["Mail.ReadWrite"],
      requiredReadScopes: readRequiredScopes.outlookMail,
    });
    assert.equal(disconnected.ok, false);
    if (!disconnected.ok) {
      assert.equal(disconnected.status, 409);
    }
  });

  it("returns 403 when the stored token is missing the existing read scope", () => {
    const result = gateIntegrationRead({
      ownerUserId: "owner-a",
      sessionUserId: "owner-a",
      status: "CONNECTED",
      grantedScopes: ["https://www.googleapis.com/auth/gmail.send"],
      requiredReadScopes: readRequiredScopes.gmail,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.code, "scope_upgrade_required");
      assert.deepEqual(result.missingScopes, ["gmail.readonly"]);
    }
  });
});

describe("mail and calendar bodies stay out of logs", () => {
  it("parses Gmail and Outlook bodies but the read log has no body field", () => {
    const gmail = parseGmailMessageBody({
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: b64url(`Hello\n${secret}`) },
          },
          {
            mimeType: "text/html",
            body: { data: b64url(`<p>ignored</p>`) },
          },
        ],
      },
    });
    assert.equal(gmail?.text, `Hello\n${secret}`);

    const htmlOnly = parseGmailMessageBody({
      payload: {
        mimeType: "text/html",
        body: {
          data: b64url(
            `<script>alert('${secret}')</script><p>See you</p><div>${secret}</div>`,
          ),
        },
      },
    });
    assert.match(htmlOnly?.text ?? "", /See you/);
    assert.match(htmlOnly?.text ?? "", new RegExp(secret));
    assert.equal(htmlOnly?.text.includes("<script"), false);
    assert.equal(htmlOnly?.text.includes("alert"), false);

    const outlook = parseOutlookMessageBody({
      body: {
        contentType: "html",
        content: `<style>p{}</style><p>${secret}</p>`,
      },
    });
    assert.equal(outlook?.text, secret);

    const log = integrationReadLog({
      family: "email",
      provider: "gmail",
      connectionId: "connection-1",
      resourceId: mirrorId,
      status: 200,
    });
    const serialized = JSON.stringify(log);
    assert.equal(serialized.includes(secret), false);
    assert.equal("body" in log, false);
    assert.equal("text" in log, false);
    assert.equal("description" in log, false);
    assert.deepEqual(Object.keys(log).sort(), [
      "connectionId",
      "family",
      "integrationRead",
      "provider",
      "resourceId",
      "status",
    ]);
  });

  it("parses calendar detail without putting the description on the read log", () => {
    const google = parseGoogleCalendarEvent({
      summary: "Standup",
      location: "Room 4",
      description: secret,
      start: { dateTime: "2026-11-18T15:00:00.000Z" },
      end: { dateTime: "2026-11-18T15:30:00.000Z" },
      attendees: [
        { email: "ada@example.com", displayName: "Ada", responseStatus: "accepted" },
      ],
    });
    assert.equal(google?.title, "Standup");
    assert.equal(google?.location, "Room 4");
    assert.equal(google?.description, secret);
    assert.equal(google?.attendees[0]?.email, "ada@example.com");
    assert.equal(google?.allDay, false);

    const outlook = parseOutlookCalendarEvent({
      subject: "Review",
      isAllDay: false,
      location: { displayName: "Teams" },
      start: { dateTime: "2026-11-18T16:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-11-18T16:30:00.0000000", timeZone: "UTC" },
      body: { contentType: "html", content: `<p>${secret}</p><script>nope</script>` },
      attendees: [
        {
          emailAddress: { name: "Grace", address: "grace@example.com" },
          status: { response: "tentativelyAccepted" },
        },
      ],
    });
    assert.equal(outlook?.location, "Teams");
    assert.equal(outlook?.description, secret);
    assert.equal(outlook?.attendees[0]?.status, "tentativelyAccepted");
    assert.equal(outlook?.startsAt, "2026-11-18T16:00:00.000Z");

    const log = integrationReadLog({
      family: "calendar",
      provider: "google",
      connectionId: "connection-1",
      resourceId: mirrorId,
      status: 200,
    });
    assert.equal(JSON.stringify(log).includes(secret), false);
  });
});

describe("calendar delete uses the existing write scopes", () => {
  it("does not add OAuth scopes beyond calendar.events and Calendars.ReadWrite", () => {
    assert.deepEqual(calendarProviders.google.scopes, [
      "https://www.googleapis.com/auth/calendar.events",
    ]);
    assert.deepEqual(calendarProviders.outlook.scopes, [
      "offline_access",
      "Calendars.ReadWrite",
      "User.Read",
    ]);
    assert.deepEqual(emailProviders.gmail.scopes, [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    assert.ok(emailProviders["outlook-mail"].scopes.includes("Mail.ReadWrite"));
    assert.deepEqual(readRequiredScopes.googleCalendar, ["calendar.events"]);
    assert.deepEqual(readRequiredScopes.outlookCalendar, ["Calendars.ReadWrite"]);
  });

  it("builds a delete request and treats an already-removed event as gone", () => {
    const google = buildCalendarDeleteRequest("google", "primary", "evt/1");
    assert.equal(google.method, "DELETE");
    assert.equal(
      google.url,
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/evt%2F1",
    );
    const outlook = buildCalendarDeleteRequest(
      "outlook",
      "primary",
      "AAMk/AGI=",
    );
    assert.equal(
      outlook.url,
      "https://graph.microsoft.com/v1.0/me/events/AAMk%2FAGI%3D",
    );
    assert.equal(calendarDeleteAccepted(204), true);
    assert.equal(calendarDeleteAccepted(410), true);
    assert.equal(calendarDeleteAccepted(403), false);
    assert.match(gmailMessageBodyUrl("msg 1"), /format=full/);
    assert.match(outlookMessageBodyUrl("msg/1"), /(?:\$|%24)select=body/);
    assert.match(googleEventDetailUrl("primary", "evt/1"), /evt%2F1/);
    assert.match(outlookEventDetailUrl("evt/1"), /(?:\$|%24)select=subject/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateCalendarEventWritePayload } from "../src/integrations/calendar-write.js";
import {
  buildEmailDraftCreateRequest,
  buildEmailSendRequest,
  emailAttachmentLimits,
  emailWriteBodyLimit,
  sanitizeEmailHtml,
  validateEmailDraftWritePayload,
} from "../src/integrations/email-write.js";
import {
  parseLinearIssueMutationResult,
  validateGitHubIssueWritePayload,
} from "../src/integrations/work-write.js";
import {
  parseSlackMessageWriteResult,
  validateSlackMessageWritePayload,
} from "../src/integrations/collab-write.js";
import { gateIntegrationWrite } from "../src/integrations/write-gate.js";
import {
  connectionNeedsScopeUpgrade,
  hasAllScopes,
  missingScopes,
  writeRequiredScopes,
} from "../src/integrations/write-scopes.js";
import { calendarProviders } from "../src/integrations/calendar-providers.js";
import { emailProviders } from "../src/integrations/email-providers.js";
import { workProviders } from "../src/integrations/work-providers.js";
import { collabProviders } from "../src/integrations/collab-providers.js";

describe("integration write scopes", () => {
  it("requests Phase 4.2 write-capable provider scopes", () => {
    assert.deepEqual(calendarProviders.google.scopes, [
      "https://www.googleapis.com/auth/calendar.events",
    ]);
    assert.ok(
      calendarProviders.outlook.scopes.includes("Calendars.ReadWrite"),
    );
    assert.ok(
      !calendarProviders.outlook.scopes.includes("Calendars.Read"),
    );
    assert.ok(
      emailProviders.gmail.scopes.some((scope) => scope.endsWith("gmail.compose")),
    );
    assert.ok(
      emailProviders.gmail.scopes.some((scope) => scope.endsWith("gmail.send")),
    );
    assert.ok(
      emailProviders["outlook-mail"].scopes.includes("Mail.ReadWrite"),
    );
    assert.ok(emailProviders["outlook-mail"].scopes.includes("Mail.Send"));
    assert.ok(!emailProviders["outlook-mail"].scopes.includes("Mail.Read"));
    assert.deepEqual(workProviders.github.scopes, ["read:user", "repo"]);
    assert.deepEqual(workProviders.linear.scopes, ["read", "write"]);
    assert.ok(collabProviders.slack.scopes.includes("chat:write"));
    assert.ok(
      !collabProviders.slack.scopes.some((scope) => /history/i.test(scope)),
    );
  });

  it("normalizes Google URL scopes against short names", () => {
    assert.deepEqual(
      missingScopes(
        ["https://www.googleapis.com/auth/calendar.events"],
        ["calendar.events"],
      ),
      [],
    );
    assert.ok(
      hasAllScopes(["repo", "read:user"], [...writeRequiredScopes.github]),
    );
    assert.ok(
      connectionNeedsScopeUpgrade(
        ["channels:read", "groups:read", "users:read"],
        writeRequiredScopes.slack,
      ),
    );
  });
});

describe("integration write gate (authz + missing scope)", () => {
  it("returns 404 for IDOR / missing owner (no leak)", () => {
    const denied = gateIntegrationWrite({
      ownerUserId: "owner-a",
      sessionUserId: "attacker-b",
      status: "CONNECTED",
      grantedScopes: ["repo"],
      requiredWriteScopes: writeRequiredScopes.github,
      writesEnabled: true,
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.status, 404);
      assert.equal(denied.error, "Not found");
    }

    const missing = gateIntegrationWrite({
      ownerUserId: null,
      sessionUserId: "user-a",
      status: "CONNECTED",
      grantedScopes: [],
      requiredWriteScopes: writeRequiredScopes.gmail,
      writesEnabled: true,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.status, 404);
    }
  });

  it("returns 403 with missingScopes when reconnect is required", () => {
    const result = gateIntegrationWrite({
      ownerUserId: "user-a",
      sessionUserId: "user-a",
      status: "CONNECTED",
      grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      requiredWriteScopes: writeRequiredScopes.gmail,
      writesEnabled: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.code, "scope_upgrade_required");
      assert.ok(result.missingScopes?.includes("gmail.compose"));
      assert.ok(result.missingScopes?.includes("gmail.send"));
    }
  });

  it("returns 503 when writes feature flag is off", () => {
    const result = gateIntegrationWrite({
      ownerUserId: "user-a",
      sessionUserId: "user-a",
      status: "CONNECTED",
      grantedScopes: ["repo", "read:user"],
      requiredWriteScopes: writeRequiredScopes.github,
      writesEnabled: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
      assert.equal(result.code, "writes_disabled");
    }
  });

  it("allows owner with required scopes when writes are enabled", () => {
    const result = gateIntegrationWrite({
      ownerUserId: "user-a",
      sessionUserId: "user-a",
      status: "CONNECTED",
      grantedScopes: ["repo", "read:user"],
      requiredWriteScopes: writeRequiredScopes.github,
      writesEnabled: true,
    });
    assert.equal(result.ok, true);
  });
});

describe("integration write payload validators", () => {
  it("validates calendar / email / github / slack structured payloads", () => {
    const calendar = validateCalendarEventWritePayload({
      title: "Sync",
      startsAt: "2026-11-18T15:00:00.000Z",
      endsAt: "2026-11-18T15:30:00.000Z",
    });
    assert.equal(calendar.ok, true);

    const badCalendar = validateCalendarEventWritePayload({
      title: "Sync",
      startsAt: "nope",
      endsAt: "2026-11-18T15:30:00.000Z",
    });
    assert.equal(badCalendar.ok, false);

    const draft = validateEmailDraftWritePayload({
      to: ["ada@example.com"],
      subject: "Hello",
      body: "Draft body",
    });
    assert.equal(draft.ok, true);

    const hostile = validateEmailDraftWritePayload({
      to: ["ada@gmial.com"],
      subject: "Hello\nBcc: eve@evil.test",
      body: "Draft body",
    });
    assert.equal(hostile.ok, false);

    const html = validateEmailDraftWritePayload({
      to: ["ada@example.com"],
      subject: "Hello",
      body: "Hello team",
      html: '<script>alert(1)</script><strong onclick="x">team</strong><a href="javascript:alert(1)">x</a>',
    });
    assert.equal(html.ok, true);
    if (html.ok) {
      assert.equal(html.payload.contentType, "text/html");
      assert.equal(html.payload.html?.includes("<script"), false);
      assert.equal(html.payload.html?.includes("javascript:"), false);
      assert.match(html.payload.html ?? "", /<strong>team<\/strong>/);
    }
    assert.equal(
      sanitizeEmailHtml('<img src=x onerror=alert(1)>ok').includes("onerror"),
      false,
    );

    const gmailSend = buildEmailSendRequest("gmail", {
      to: ["ada@example.com"],
      subject: "Hello",
      body: "Hello team",
      html: "<strong>team</strong>",
      contentType: "text/html",
    });
    assert.equal(
      gmailSend.url,
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    const outlookSend = buildEmailSendRequest("outlook-mail", {
      to: ["ada@example.com"],
      subject: "Hello",
      body: "Hello",
    });
    assert.equal(
      outlookSend.url,
      "https://graph.microsoft.com/v1.0/me/sendMail",
    );

    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const pngSize = Buffer.from(pngBase64, "base64").length;
    const withFile = validateEmailDraftWritePayload({
      to: ["ada@example.com"],
      subject: "Notes",
      body: "See the image.",
      attachments: [
        {
          filename: "pixel.png",
          contentType: "image/png",
          size: pngSize,
          contentBase64: pngBase64,
        },
      ],
    });
    assert.equal(withFile.ok, true);
    if (withFile.ok) {
      const gmailFile = buildEmailSendRequest("gmail", withFile.payload);
      const raw = Buffer.from(
        String((gmailFile.body as { raw: string }).raw)
          .replace(/-/g, "+")
          .replace(/_/g, "/"),
        "base64",
      ).toString("utf8");
      assert.match(raw, /multipart\/mixed/);
      assert.match(raw, /Content-Disposition: attachment; filename="pixel\.png"/);
      assert.match(raw, /Content-Type: image\/png/);
      assert.match(raw, new RegExp(pngBase64.slice(0, 40)));
      const outlookFile = buildEmailSendRequest("outlook-mail", withFile.payload);
      const outlookBody = outlookFile.body as {
        message: {
          attachments: Array<{
            "@odata.type": string;
            name: string;
            contentType: string;
            contentBytes: string;
          }>;
        };
      };
      assert.equal(
        outlookBody.message.attachments[0]?.["@odata.type"],
        "#microsoft.graph.fileAttachment",
      );
      assert.equal(outlookBody.message.attachments[0]?.name, "pixel.png");
      assert.equal(outlookBody.message.attachments[0]?.contentBytes, pngBase64);
      const draft = buildEmailDraftCreateRequest("outlook-mail", withFile.payload);
      const draftBody = draft.body as {
        isDraft: boolean;
        attachments: Array<{ name: string }>;
      };
      assert.equal(draftBody.isDraft, true);
      assert.equal(draftBody.attachments[0]?.name, "pixel.png");
    }
    const script = validateEmailDraftWritePayload({
      to: ["ada@example.com"],
      subject: "Notes",
      body: "Nope",
      attachments: [
        {
          filename: "notes.pdf",
          contentType: "application/pdf",
          size: Buffer.byteLength("%PDF-1.4\n<script>alert(1)</script>"),
          contentBase64: Buffer.from(
            "%PDF-1.4\n<script>alert(1)</script>",
          ).toString("base64"),
        },
      ],
    });
    assert.equal(script.ok, false);
    const svg = validateEmailDraftWritePayload({
      to: ["ada@example.com"],
      subject: "Notes",
      body: "Nope",
      attachments: [
        {
          filename: "icon.svg",
          contentType: "image/svg+xml",
          size: 4,
          contentBase64: Buffer.from("<svg/>").toString("base64"),
        },
      ],
    });
    assert.equal(svg.ok, false);
    const base64Budget = Math.ceil(emailAttachmentLimits.maxBytesTotal / 3) * 4;
    assert.ok(base64Budget + 100_000 < emailWriteBodyLimit);

    const issue = validateGitHubIssueWritePayload({
      owner: "acme",
      repo: "app",
      title: "Ship write APIs",
    });
    assert.equal(issue.ok, true);

    const slack = validateSlackMessageWritePayload({
      channelId: "C01234567",
      text: "Hello ops",
    });
    assert.equal(slack.ok, true);

    const badSlack = validateSlackMessageWritePayload({
      channelId: "#general",
      text: "nope",
    });
    assert.equal(badSlack.ok, false);
  });

  it("parses opaque provider write results without requiring bodies", () => {
    const linear = parseLinearIssueMutationResult({
      data: {
        issueCreate: {
          success: true,
          issue: {
            id: "iss-1",
            identifier: "ENG-9",
            url: "https://linear.app/acme/issue/ENG-9",
          },
        },
      },
    });
    assert.equal(linear?.id, "iss-1");
    assert.equal(linear?.identifier, "ENG-9");

    const slack = parseSlackMessageWriteResult({
      ok: true,
      channel: "C01234567",
      ts: "1731672000.000100",
    });
    assert.equal(slack?.ts, "1731672000.000100");
  });
});

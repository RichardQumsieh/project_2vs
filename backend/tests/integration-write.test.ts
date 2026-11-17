import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateCalendarEventWritePayload } from "../src/integrations/calendar-write.js";
import { validateEmailDraftWritePayload } from "../src/integrations/email-write.js";
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
      emailProviders["outlook-mail"].scopes.includes("Mail.ReadWrite"),
    );
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

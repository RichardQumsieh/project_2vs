import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvalExecutingStaleMs,
  approvalPendingTtlMs,
  approveMailCalendarWrite,
  auditMetadata,
  directWriteDecision,
  hashApproval,
  performMailCalendarApproval,
  proposeMailCalendarWrite,
  type ApprovalConnection,
  type ApprovalRecord,
  type ApprovalStore,
  type MailCalendarAction,
  type MailCalendarProvider,
  type ProviderHttp,
  type ValidatedProposal,
} from "../src/integrations/mail-calendar-approval.js";
import { gateIntegrationWrite } from "../src/integrations/write-gate.js";

const secretToken = "super-secret-token";
const secretSubject = "Quarterly secret";
const secretBody = "hidden body do-not-log";
const mirrorId = "11111111-1111-4111-8111-111111111111";
const fixedNow = new Date("2026-11-19T02:00:00.000Z");

const emailPayload = {
  to: ["ada@example.com"],
  subject: secretSubject,
  body: secretBody,
};

const reschedulePayload = {
  title: "Design review",
  startsAt: "2026-11-20T15:00:00.000Z",
  endsAt: "2026-11-20T15:30:00.000Z",
  externalEventId: "evt/1",
  description: secretBody,
};

function connected(overrides: Partial<ApprovalConnection> = {}): ApprovalConnection {
  return {
    id: "conn-1",
    ownerUserId: "user-a",
    status: "CONNECTED",
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
      "Mail.Send",
      "Mail.ReadWrite",
      "https://www.googleapis.com/auth/calendar.events",
      "Calendars.ReadWrite",
    ],
    refreshTokenEncrypted: "encrypted-refresh",
    accessTokenEncrypted: "encrypted-access",
    accessTokenExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createMemoryStore(clock: () => Date = () => new Date()): ApprovalStore {
  const rows = new Map<string, ApprovalRecord>();
  const byKey = new Map<string, string>();
  const copy = (row: ApprovalRecord): ApprovalRecord => ({ ...row });
  return {
    async findByKey(ownerUserId, idempotencyKey) {
      const id = byKey.get(`${ownerUserId}\0${idempotencyKey}`);
      const row = id ? rows.get(id) : undefined;
      return row ? copy(row) : null;
    },
    async findById(id) {
      const row = rows.get(id);
      return row ? copy(row) : null;
    },
    async insert(record) {
      const key = `${record.ownerUserId}\0${record.idempotencyKey}`;
      if (byKey.has(key)) return "conflict";
      byKey.set(key, record.id);
      rows.set(record.id, { ...record });
      return "inserted";
    },
    async compareAndSet(id, from, to, patch) {
      const current = rows.get(id);
      if (!current || current.status !== from) return false;
      rows.set(id, {
        ...current,
        ...patch,
        status: to,
        updatedAt: clock().toISOString(),
      });
      return true;
    },
  };
}

function harness(options?: {
  writesEnabled?: boolean;
  allowlist?: string[];
  userEmail?: string | null;
  oauthConfigured?: boolean;
  connection?: ApprovalConnection | null;
  deleteTarget?: {
    connection: ApprovalConnection;
    calendarId: string;
    externalEventId: string;
  } | null;
  tokenError?: string | null;
  respond?: (input: {
    url: string;
    method: string;
    body?: unknown;
  }) => { status: number; json: unknown } | Promise<{ status: number; json: unknown }>;
  now?: Date;
  clock?: () => Date;
}) {
  const calls: Array<{
    url: string;
    method: string;
    accessToken: string;
    body?: unknown;
  }> = [];
  const audits: Array<Record<string, string>> = [];
  const cleanups: Array<{ connectionId: string; externalId: string | null }> = [];
  const flags = {
    writesEnabled: options?.writesEnabled ?? true,
    allowlist: options?.allowlist ?? ([] as string[]),
    tokenError: options?.tokenError ?? null,
    connection: options && "connection" in options ? options.connection ?? null : connected(),
    deleteTarget:
      options && "deleteTarget" in options
        ? options.deleteTarget ?? null
        : {
            connection: connected(),
            calendarId: "primary",
            externalEventId: "evt/1",
          },
  };
  const http: ProviderHttp = {
    async request(input) {
      calls.push(input);
      if (options?.respond) return options.respond(input);
      return {
        status: 200,
        json: {
          id: "provider-1",
          htmlLink: "https://calendar.example/event",
          webLink: "https://outlook.example/event",
        },
      };
    },
  };
  const store = createMemoryStore(options?.clock);
  const now = () => options?.clock?.() ?? options?.now ?? fixedNow;

  async function perform(proposal: ValidatedProposal) {
    return performMailCalendarApproval({
      proposal,
      sessionUserId: "user-a",
      username: "ada",
      userEmail: options?.userEmail ?? "ada@example.com",
      writesEnabled: flags.writesEnabled,
      allowlist: flags.allowlist,
      oauthConfigured: options?.oauthConfigured ?? true,
      loadConnection: async () => flags.connection,
      loadDeleteTarget: async () => flags.deleteTarget,
      resolveAccessToken: async () => {
        if (flags.tokenError) throw new Error(flags.tokenError);
        return secretToken;
      },
      http,
      afterSuccess: async (info) => {
        cleanups.push(info);
      },
    });
  }

  return {
    calls,
    audits,
    cleanups,
    flags,
    store,
    propose(body: unknown, ownerUserId = "user-a") {
      return proposeMailCalendarWrite({
        ownerUserId,
        body,
        store,
        now: now(),
        createId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
    },
    approve(id: string, payload: unknown, ownerUserId = "user-a") {
      return approveMailCalendarWrite({
        ownerUserId,
        actorUserId: ownerUserId,
        actorLabel: "ada",
        approvalId: id,
        payload,
        store,
        now: now(),
        perform,
        audit: {
          async record(entry) {
            const meta = auditMetadata(entry.action);
            audits.push({
              action: meta.activity,
              summary: meta.summary,
              subjectKind: meta.subjectKind,
              subjectId: entry.provider,
              ownerUserId: entry.ownerUserId,
            });
          },
        },
      });
    },
  };
}

function assertNoSecrets(value: unknown) {
  const json = JSON.stringify(value);
  assert.equal(json.includes(secretSubject), false);
  assert.equal(json.includes(secretBody), false);
  assert.equal(json.includes(secretToken), false);
  assert.equal(json.includes("encrypted-refresh"), false);
}

describe("mail and calendar approval loop", () => {
  it("keeps audit metadata free of message and event content", () => {
    for (const action of [
      "send_email",
      "save_draft",
      "reschedule_event",
      "delete_event",
    ] as const) {
      const meta = auditMetadata(action);
      assert.match(meta.summary, /^Approved /);
      assert.equal(JSON.stringify(meta).includes("@"), false);
    }
  });

  it("refuses a direct write even when the gate is open", () => {
    const open = directWriteDecision({ ok: true });
    assert.equal(open.httpStatus, 409);
    assert.equal(open.code, "approval_required");
    const closed = directWriteDecision(
      gateIntegrationWrite({
        ownerUserId: "user-a",
        sessionUserId: "user-a",
        status: "CONNECTED",
        grantedScopes: ["gmail.send"],
        requiredWriteScopes: ["gmail.send"],
        writesEnabled: false,
      }) as { ok: false; status: 503; error: string; code: string },
    );
    assert.equal(closed.httpStatus, 503);
    assert.equal(closed.code, "writes_disabled");
  });

  it("hashes the normalized proposal, not key order", () => {
    const left = hashApproval({
      action: "send_email",
      provider: "gmail",
      payload: { to: ["ada@example.com"], subject: "Hi", body: "There" },
    });
    const right = hashApproval({
      provider: "gmail",
      payload: { body: "There", to: ["ada@example.com"], subject: "Hi" },
      action: "send_email",
    });
    assert.equal(left, right);
    assert.notEqual(
      left,
      hashApproval({
        action: "save_draft",
        provider: "gmail",
        payload: { to: ["ada@example.com"], subject: "Hi", body: "There" },
      }),
    );
  });

  const cases: Array<{
    name: string;
    action: MailCalendarAction;
    provider: MailCalendarProvider;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    method: string;
    url: string;
    status: number;
    json: unknown;
    externalId: string | null;
    bodyIncludes?: string;
  }> = [
    {
      name: "gmail send",
      action: "send_email",
      provider: "gmail",
      payload: emailPayload,
      idempotencyKey: "approve-gmail-send",
      method: "POST",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      status: 200,
      json: { id: "msg-gmail" },
      externalId: "msg-gmail",
    },
    {
      name: "outlook send",
      action: "send_email",
      provider: "outlook-mail",
      payload: emailPayload,
      idempotencyKey: "approve-outlook-send",
      method: "POST",
      url: "https://graph.microsoft.com/v1.0/me/sendMail",
      status: 202,
      json: null,
      externalId: null,
      bodyIncludes: secretSubject,
    },
    {
      name: "gmail draft",
      action: "save_draft",
      provider: "gmail",
      payload: emailPayload,
      idempotencyKey: "approve-gmail-draft",
      method: "POST",
      url: "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      status: 200,
      json: { id: "draft-gmail" },
      externalId: "draft-gmail",
    },
    {
      name: "outlook draft",
      action: "save_draft",
      provider: "outlook-mail",
      payload: emailPayload,
      idempotencyKey: "approve-outlook-draft",
      method: "POST",
      url: "https://graph.microsoft.com/v1.0/me/messages",
      status: 201,
      json: { id: "draft-outlook" },
      externalId: "draft-outlook",
      bodyIncludes: "isDraft",
    },
    {
      name: "google reschedule",
      action: "reschedule_event",
      provider: "google",
      payload: reschedulePayload,
      idempotencyKey: "approve-google-move",
      method: "PATCH",
      url: "https://www.googleapis.com/calendar/v3/calendars/primary/events/evt%2F1",
      status: 200,
      json: { id: "evt/1", htmlLink: "https://calendar.example/event" },
      externalId: "evt/1",
    },
    {
      name: "outlook reschedule",
      action: "reschedule_event",
      provider: "outlook",
      payload: reschedulePayload,
      idempotencyKey: "approve-outlook-move",
      method: "PATCH",
      url: "https://graph.microsoft.com/v1.0/me/events/evt%2F1",
      status: 200,
      json: { id: "evt/1", webLink: "https://outlook.example/event" },
      externalId: "evt/1",
    },
    {
      name: "google delete",
      action: "delete_event",
      provider: "google",
      payload: { eventId: mirrorId },
      idempotencyKey: "approve-google-delete",
      method: "DELETE",
      url: "https://www.googleapis.com/calendar/v3/calendars/primary/events/evt%2F1",
      status: 204,
      json: null,
      externalId: "evt/1",
    },
    {
      name: "outlook delete already gone",
      action: "delete_event",
      provider: "outlook",
      payload: { eventId: mirrorId },
      idempotencyKey: "approve-outlook-delete",
      method: "DELETE",
      url: "https://graph.microsoft.com/v1.0/me/events/evt%2F1",
      status: 404,
      json: { error: { message: secretBody } },
      externalId: "evt/1",
    },
  ];

  for (const item of cases) {
    it(`runs ${item.name} once and replays the approval`, async () => {
      const box = harness({
        respond: () => ({ status: item.status, json: item.json }),
      });
      const proposed = await box.propose({
        idempotencyKey: item.idempotencyKey,
        action: item.action,
        provider: item.provider,
        payload: item.payload,
      });
      assert.equal(proposed.ok, true);
      assert.equal(box.calls.length, 0);
      if (!proposed.ok) return;
      assert.equal(proposed.status, "pending");

      const approved = await box.approve(proposed.id, item.payload);
      assert.equal(approved.ok, true);
      if (!approved.ok) return;
      assert.equal(approved.replayed, false);
      assert.equal(approved.externalId, item.externalId);
      assert.equal(box.calls.length, 1);
      assert.equal(box.calls[0]?.method, item.method);
      assert.equal(box.calls[0]?.url, item.url);
      assert.equal(box.calls[0]?.accessToken, secretToken);
      if (item.bodyIncludes) {
        assert.equal(JSON.stringify(box.calls[0]?.body).includes(item.bodyIncludes), true);
      }
      assert.equal(box.audits.length, 1);
      assert.equal(box.audits[0]?.subjectId, item.provider);
      assertNoSecrets(box.audits);
      assertNoSecrets({
        externalId: approved.externalId,
        error: "ok" in approved ? undefined : approved,
      });

      const replay = await box.approve(proposed.id, item.payload);
      assert.equal(replay.ok, true);
      if (!replay.ok) return;
      assert.equal(replay.replayed, true);
      assert.equal(replay.externalId, item.externalId);
      assert.equal(box.calls.length, 1);
      assert.equal(box.audits.length, 1);
      assert.equal(box.cleanups.length, 1);
    });
  }

  it("does not call the provider when the flag is off, then sends after it is on", async () => {
    const box = harness({ writesEnabled: false });
    const proposed = await box.propose({
      idempotencyKey: "approve-flag-off",
      action: "send_email",
      provider: "gmail",
      payload: emailPayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const blocked = await box.approve(proposed.id, emailPayload);
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "writes_disabled");
    assert.equal(box.calls.length, 0);
    assert.equal(box.audits.length, 0);
    const pending = await box.store.findById(proposed.id);
    assert.equal(pending?.status, "pending");

    box.flags.writesEnabled = true;
    const sent = await box.approve(proposed.id, emailPayload);
    assert.equal(sent.ok, true);
    assert.equal(box.calls.length, 1);
    assert.equal(box.audits.length, 1);
  });

  it("does not call the provider for an account outside the allowlist", async () => {
    const box = harness({
      allowlist: ["other-user"],
      userEmail: "ada@example.com",
    });
    const proposed = await box.propose({
      idempotencyKey: "approve-allowlist",
      action: "save_draft",
      provider: "outlook-mail",
      payload: emailPayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const denied = await box.approve(proposed.id, emailPayload);
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.code, "writes_not_enabled_for_user");
    assert.equal(box.calls.length, 0);
    box.flags.allowlist = ["ada@example.com"];
    const saved = await box.approve(proposed.id, emailPayload);
    assert.equal(saved.ok, true);
    assert.equal(box.calls.length, 1);
  });

  it("returns a clear scope error and does not call the provider", async () => {
    const box = harness({
      connection: connected({
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      }),
    });
    const proposed = await box.propose({
      idempotencyKey: "approve-scopes",
      action: "send_email",
      provider: "gmail",
      payload: emailPayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const missing = await box.approve(proposed.id, emailPayload);
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.httpStatus, 403);
    assert.equal(missing.code, "scope_upgrade_required");
    assert.ok(missing.missingScopes?.includes("gmail.send"));
    assert.equal(box.calls.length, 0);
    assert.equal((await box.store.findById(proposed.id))?.status, "pending");
  });

  it("keeps a token failure retryable and then sends once", async () => {
    const box = harness({ tokenError: "token_refresh_401" });
    const proposed = await box.propose({
      idempotencyKey: "approve-token",
      action: "reschedule_event",
      provider: "google",
      payload: reschedulePayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const failed = await box.approve(proposed.id, reschedulePayload);
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.code, "token_refresh_401");
    assert.match(failed.error, /Nothing was sent/);
    assert.equal(box.calls.length, 0);
    box.flags.tokenError = null;
    const moved = await box.approve(proposed.id, reschedulePayload);
    assert.equal(moved.ok, true);
    assert.equal(box.calls.length, 1);
  });

  it("does not retry a provider error or include the provider body", async () => {
    const box = harness({
      respond: async () => ({
        status: 400,
        json: { error: { message: secretBody } },
      }),
    });
    const proposed = await box.propose({
      idempotencyKey: "approve-provider-400",
      action: "send_email",
      provider: "gmail",
      payload: emailPayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const failed = await box.approve(proposed.id, emailPayload);
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.code, "email_send_400");
    assertNoSecrets(failed);
    assert.equal(box.audits.length, 0);
    const again = await box.approve(proposed.id, emailPayload);
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.replayed, true);
    assert.equal(again.code, "email_send_400");
    assert.equal(box.calls.length, 1);
    assert.equal((await box.store.findById(proposed.id))?.status, "failed");
  });

  it("treats a dropped provider call as uncertain and does not send twice", async () => {
    const box = harness({
      respond: async () => {
        throw new Error(`socket hangup ${secretToken}`);
      },
    });
    const proposed = await box.propose({
      idempotencyKey: "approve-uncertain",
      action: "send_email",
      provider: "outlook-mail",
      payload: emailPayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const failed = await box.approve(proposed.id, emailPayload);
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.code, "provider_uncertain");
    assertNoSecrets(failed);
    await box.approve(proposed.id, emailPayload);
    assert.equal(box.calls.length, 1);
    assert.equal(box.audits.length, 0);
  });

  it("rejects a changed payload and a second owner without calling the provider", async () => {
    const box = harness();
    const proposed = await box.propose({
      idempotencyKey: "approve-mismatch",
      action: "save_draft",
      provider: "gmail",
      payload: emailPayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const mismatch = await box.approve(proposed.id, {
      ...emailPayload,
      subject: "Different subject",
    });
    assert.equal(mismatch.ok, false);
    if (mismatch.ok) return;
    assert.equal(mismatch.code, "payload_mismatch");
    const otherOwner = await box.approve(proposed.id, emailPayload, "user-b");
    assert.equal(otherOwner.ok, false);
    if (otherOwner.ok) return;
    assert.equal(otherOwner.httpStatus, 404);
    assert.equal(box.calls.length, 0);
    const reused = await box.propose({
      idempotencyKey: "approve-mismatch",
      action: "send_email",
      provider: "gmail",
      payload: emailPayload,
    });
    assert.equal(reused.ok, false);
    if (reused.ok) return;
    assert.equal(reused.code, "idempotency_key_reused");
  });

  it("does not run an expired proposal", async () => {
    const box = harness({
      now: new Date(fixedNow.getTime() + approvalPendingTtlMs + 1_000),
    });
    const stored = await proposeMailCalendarWrite({
      ownerUserId: "user-a",
      body: {
        idempotencyKey: "approve-expired",
        action: "delete_event",
        provider: "google",
        payload: { eventId: mirrorId },
      },
      store: box.store,
      now: fixedNow,
    });
    assert.equal(stored.ok, true);
    if (!stored.ok) return;
    const expired = await box.approve(stored.id, { eventId: mirrorId });
    assert.equal(expired.ok, false);
    if (expired.ok) return;
    assert.equal(expired.code, "approval_expired");
    assert.equal(box.calls.length, 0);
  });

  it("does not delete a missing mirror and does not call the provider", async () => {
    const box = harness({ deleteTarget: null });
    const proposed = await box.propose({
      idempotencyKey: "approve-missing-event",
      action: "delete_event",
      provider: "outlook",
      payload: { eventId: mirrorId },
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const missing = await box.approve(proposed.id, { eventId: mirrorId });
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.httpStatus, 404);
    await box.approve(proposed.id, { eventId: mirrorId });
    assert.equal(box.calls.length, 0);
    assert.equal((await box.store.findById(proposed.id))?.status, "failed");
  });

  it("lets only one of two overlapping approvals call the provider", async () => {
    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const box = harness({
      respond: async () => {
        await hold;
        return { status: 200, json: { id: "msg-once" } };
      },
    });
    const proposed = await box.propose({
      idempotencyKey: "approve-concurrent",
      action: "send_email",
      provider: "gmail",
      payload: emailPayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const first = box.approve(proposed.id, emailPayload);
    const second = box.approve(proposed.id, emailPayload);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(box.calls.length, 1);
    release?.();
    const results = await Promise.all([first, second]);
    const succeeded = results.filter((result) => result.ok);
    const inProgress = results.filter(
      (result) => !result.ok && result.code === "approval_in_progress",
    );
    assert.equal(succeeded.length, 1);
    assert.equal(inProgress.length, 1);
    assert.equal(box.calls.length, 1);
    assert.equal(box.audits.length, 1);
  });

  it("does not retry an approval that stayed in progress", async () => {
    const clock = { time: fixedNow.getTime() };
    const box = harness({
      now: fixedNow,
      clock: () => new Date(clock.time),
    });
    const proposed = await box.propose({
      idempotencyKey: "approve-stale",
      action: "send_email",
      provider: "gmail",
      payload: emailPayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const claimed = await box.store.compareAndSet(proposed.id, "pending", "executing", {});
    assert.equal(claimed, true);
    clock.time += approvalExecutingStaleMs + 1_000;
    const stalled = await box.approve(proposed.id, emailPayload);
    assert.equal(stalled.ok, false);
    if (stalled.ok) return;
    assert.equal(stalled.code, "approval_unconfirmed");
    assert.equal(box.calls.length, 0);
  });

  it("rejects a disconnected account before any provider call", async () => {
    const box = harness({ connection: null });
    const proposed = await box.propose({
      idempotencyKey: "approve-disconnected",
      action: "save_draft",
      provider: "gmail",
      payload: emailPayload,
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    const missing = await box.approve(proposed.id, emailPayload);
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.code, "not_connected");
    assert.match(missing.error, /Nothing was sent/);
    assert.equal(box.calls.length, 0);
    assert.equal((await box.store.findById(proposed.id))?.status, "pending");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activityExportEventKeys,
  activityListFilter,
  activityReadDecision,
  activityWriteOwner,
  sanitizeActivityWrite,
  toActivityExport,
} from "../src/account-activity.js";
import {
  CLOUD_SOPHIA_CONSENT_ERROR,
  CLOUD_SOPHIA_CONSENT_VERSION,
  CLOUD_SOPHIA_PURPOSE,
  CLOUD_SOPHIA_UNCONFIGURED_ERROR,
  buildCloudModelPayload,
  buildConnectedContextLines,
  cloudRequestMayIncludePrivatePlaintext,
  decideCloudSophiaPath,
  executeCloudModelCall,
  prepareCloudCompletion,
  type CloudConsentSnapshot,
} from "../src/cloud-sophia-policy.js";
import { recordActivitySchema, registerSchema } from "../src/schemas.js";

const promptSentinel = "unique-prompt-sentinel-not-for-logs";
const activeConsent: CloudConsentSnapshot = {
  userId: "user-a",
  purposeText: CLOUD_SOPHIA_PURPOSE,
  versionId: CLOUD_SOPHIA_CONSENT_VERSION,
  withdrawnAt: null,
};

function refusingFetch(): typeof fetch {
  return (async () => {
    throw new Error("fetch must not be called");
  }) as typeof fetch;
}

describe("cloud sophia consent gate", () => {
  it("does not call the model when consent is missing", async () => {
    const logs: unknown[] = [];
    const prepared = prepareCloudCompletion({
      body: { prompt: promptSentinel },
      sessionUserId: "user-a",
      consent: null,
      apiKey: "test-key",
      baseUrl: "https://model.test/v1",
    });
    assert.equal(prepared.ok, false);
    if (!prepared.ok) {
      assert.equal(prepared.callModel, false);
      assert.equal(prepared.status, 403);
      assert.equal(prepared.error, CLOUD_SOPHIA_CONSENT_ERROR);
    }

    const result = await executeCloudModelCall({
      sessionUserId: "user-a",
      consent: null,
      apiKey: "test-key",
      baseUrl: "https://model.test/v1",
      model: "grok-4",
      prompt: promptSentinel,
      contextLines: ["Calendar: secret standup"],
      fetchImpl: refusingFetch(),
      log: (fields) => logs.push(fields),
    });

    assert.equal(result.calledModel, false);
    assert.equal(result.status, 403);
    assert.equal(result.body.reply, undefined);
    assert.equal(JSON.stringify(logs).includes(promptSentinel), false);
    assert.equal(JSON.stringify(logs).includes("test-key"), false);
    assert.deepEqual(Object.keys(logs[0] as object).sort(), ["outcome", "status", "userId"]);
  });

  it("does not call the model after consent is withdrawn", async () => {
    const withdrawn: CloudConsentSnapshot = {
      ...activeConsent,
      withdrawnAt: new Date("2026-11-18T12:00:00.000Z"),
    };
    const prepared = prepareCloudCompletion({
      body: { prompt: "What is on my calendar?" },
      sessionUserId: "user-a",
      consent: withdrawn,
      apiKey: "test-key",
      baseUrl: "https://model.test/v1",
    });
    assert.equal(prepared.ok, false);
    if (!prepared.ok) {
      assert.equal(prepared.callModel, false);
      assert.equal(prepared.status, 403);
    }
    const result = await executeCloudModelCall({
      sessionUserId: "user-a",
      consent: withdrawn,
      apiKey: "test-key",
      baseUrl: "https://model.test/v1",
      model: "grok-4",
      prompt: promptSentinel,
      contextLines: [],
      fetchImpl: refusingFetch(),
      log: () => undefined,
    });
    assert.equal(result.calledModel, false);
    assert.equal(result.body.reply, undefined);
  });

  it("returns 503 and no invented reply when the model is not configured", async () => {
    const result = await executeCloudModelCall({
      sessionUserId: "user-a",
      consent: activeConsent,
      apiKey: undefined,
      baseUrl: undefined,
      model: "grok-4",
      prompt: promptSentinel,
      contextLines: [],
      fetchImpl: refusingFetch(),
      log: () => undefined,
    });
    assert.equal(result.calledModel, false);
    assert.equal(result.status, 503);
    assert.equal(result.body.error, CLOUD_SOPHIA_UNCONFIGURED_ERROR);
    assert.equal(result.body.reply, undefined);
  });

  it("rejects another user's grant and private-message fields", () => {
    const foreign = prepareCloudCompletion({
      body: { prompt: "Hello" },
      sessionUserId: "user-b",
      consent: activeConsent,
      apiKey: "test-key",
      baseUrl: "https://model.test/v1",
    });
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.equal(foreign.callModel, false);

    const smuggled = prepareCloudCompletion({
      body: { prompt: "Hello", plaintext: "decrypted private message" },
      sessionUserId: "user-a",
      consent: activeConsent,
      apiKey: "test-key",
      baseUrl: "https://model.test/v1",
    });
    assert.equal(smuggled.ok, false);
    if (!smuggled.ok) {
      assert.equal(smuggled.callModel, false);
      assert.equal(smuggled.status, 400);
    }
    assert.equal(cloudRequestMayIncludePrivatePlaintext(), false);
    assert.equal(decideCloudSophiaPath({
      consentActive: true,
      hasPrivateMessagePlaintext: true,
    }), "local");
    assert.equal(decideCloudSophiaPath({
      consentActive: false,
      hasPrivateMessagePlaintext: false,
    }), "local");
  });

  it("sends no training opt-in and does not log the prompt when a call is allowed", async () => {
    const logs: unknown[] = [];
    let sawTraining = false;
    let sawPromptInLog = false;
    const result = await executeCloudModelCall({
      sessionUserId: "user-a",
      consent: activeConsent,
      apiKey: "test-key",
      baseUrl: "https://model.test/v1",
      model: "grok-4",
      prompt: promptSentinel,
      contextLines: ["Calendar: Standup from 2026-11-18T12:00:00.000Z to 2026-11-18T12:30:00.000Z"],
      fetchImpl: (async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        sawTraining = Object.prototype.hasOwnProperty.call(body, "training")
          || JSON.stringify(body).includes('"store":true');
        assert.equal(String(init?.body).includes(promptSentinel), true);
        assert.equal(String(init?.body).includes("Standup"), true);
        assert.equal(init?.redirect, "error");
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Propose moving standup." } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch,
      log: (fields) => {
        logs.push(fields);
        sawPromptInLog = JSON.stringify(fields).includes(promptSentinel);
      },
    });
    assert.equal(result.calledModel, true);
    assert.equal(result.body.reply, "Propose moving standup.");
    assert.equal(sawTraining, false);
    assert.equal(sawPromptInLog, false);
    assert.equal(JSON.stringify(logs).includes("test-key"), false);

    const payload = buildCloudModelPayload({
      model: "grok-4",
      prompt: "Hello",
      contextLines: [],
    });
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "training"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "store"), false);
  });

  it("does not invent a reply when the provider response is unusable", async () => {
    const result = await executeCloudModelCall({
      sessionUserId: "user-a",
      consent: activeConsent,
      apiKey: "test-key",
      baseUrl: "https://model.test/v1",
      model: "grok-4",
      prompt: "Hello",
      contextLines: [],
      fetchImpl: (async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
      log: () => undefined,
    });
    assert.equal(result.status, 502);
    assert.equal(result.body.reply, undefined);
  });

  it("clips connected metadata and never adds a private-message channel", () => {
    const lines = buildConnectedContextLines({
      calendar: [{
        title: "T".repeat(500),
        startsAt: "2026-11-18T12:00:00.000Z",
        endsAt: "2026-11-18T12:30:00.000Z",
      }],
      mail: [{
        subject: "Hello",
        fromAddress: "a@example.com",
        receivedAt: "2026-11-18T12:00:00.000Z",
        snippet: "S".repeat(500),
      }],
      work: [{ provider: "github", title: "Fix login", state: "open", number: 12 }],
    });
    const joined = lines.join("\n");
    assert.equal(joined.includes("T".repeat(200)), false);
    assert.equal(joined.includes("S".repeat(200)), false);
    assert.equal(joined.includes("GitHub #12"), true);
    assert.equal(joined.includes("refreshToken"), false);
  });
});

describe("account activity log", () => {
  it("is owner-scoped and ignores a requested foreign owner", () => {
    assert.deepEqual(activityListFilter("user-a"), { ownerUserId: "user-a" });
    assert.deepEqual(activityWriteOwner("user-a"), {
      ownerUserId: "user-a",
      actorUserId: "user-a",
    });
    assert.deepEqual(activityReadDecision("user-a", "user-b"), {
      ok: false,
      status: 404,
      error: "Not found",
    });
    assert.deepEqual(activityReadDecision("user-a", "user-a"), { ok: true });
    const foreignWrite = sanitizeActivityWrite({
      ownerUserId: "user-a",
      actorUserId: "user-b",
      actorLabel: "ada",
      action: "SETTING_CHANGED",
      summary: "Changed a setting",
    });
    assert.equal(foreignWrite.ok, false);
  });

  it("exports a fixed metadata shape and drops secrets", () => {
    const exported = toActivityExport({
      ownerUserId: "user-a",
      exportedAt: "2026-11-18T12:00:00.000Z",
      events: [{
        id: "evt-1",
        actorUserId: "user-a",
        actorLabel: "ada",
        occurredAt: "2026-11-18T12:00:00.000Z",
        action: "LOGIN",
        summary: "Signed in",
        subjectKind: null,
        subjectId: null,
        token: "secret-token",
        password: "secret-password",
        body: "message body",
        prompt: "prompt body",
        plaintext: "hello plaintext",
      } as Parameters<typeof toActivityExport>[0]["events"][number]],
    });
    assert.deepEqual(Object.keys(exported).sort(), [
      "events",
      "exportedAt",
      "ownerUserId",
      "version",
    ]);
    assert.equal(exported.version, 1);
    assert.equal(exported.ownerUserId, "user-a");
    assert.deepEqual(
      Object.keys(exported.events[0]!).sort(),
      [...activityExportEventKeys()].sort(),
    );
    const json = JSON.stringify(exported);
    assert.equal(json.includes("secret-token"), false);
    assert.equal(json.includes("secret-password"), false);
    assert.equal(json.includes("message body"), false);
    assert.equal(json.includes("prompt body"), false);
    assert.equal(json.includes("plaintext"), false);
    assert.equal(exported.events[0]?.actor, "ada");
    assert.equal(exported.events[0]?.action, "LOGIN");
  });

  it("rejects unwired actions and message-sized summaries", () => {
    assert.equal(sanitizeActivityWrite({
      ownerUserId: "user-a",
      actorUserId: "user-a",
      actorLabel: "ada",
      action: "MESSAGE_SENT",
      summary: "Sent a message",
    }).ok, false);
    assert.equal(sanitizeActivityWrite({
      ownerUserId: "user-a",
      actorUserId: "user-a",
      actorLabel: "ada",
      action: "BUTTON_ACTION",
      summary: "x".repeat(161),
    }).ok, false);
    assert.equal(recordActivitySchema.safeParse({
      action: "MESSAGE_SENT",
      summary: "Sent a message",
    }).success, false);
    assert.equal(recordActivitySchema.safeParse({
      action: "BUTTON_ACTION",
      summary: "Approved email send",
      subjectKind: "email",
      subjectId: "gmail",
      body: "hello",
    }).success, false);
  });

  it("records signup consent only when the purpose and version match", () => {
    const base = {
      username: "ada",
      email: "ada@example.com",
      password: "Correct-Horse-1battery",
      passwordConfirm: "Correct-Horse-1battery",
      displayName: "Ada",
    };
    const omitted = registerSchema.safeParse(base);
    assert.equal(omitted.success, true);
    if (omitted.success) {
      assert.equal(omitted.data.cloudSophiaConsent, undefined);
    }
    const accepted = registerSchema.safeParse({
      ...base,
      cloudSophiaConsent: {
        accepted: true,
        purposeText: CLOUD_SOPHIA_PURPOSE,
        versionId: CLOUD_SOPHIA_CONSENT_VERSION,
      },
    });
    assert.equal(accepted.success, true);
    assert.equal(registerSchema.safeParse({
      ...base,
      cloudSophiaConsent: {
        accepted: true,
        purposeText: "Sophia may read everything",
        versionId: CLOUD_SOPHIA_CONSENT_VERSION,
      },
    }).success, false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Writable } from "node:stream";
import Fastify from "fastify";
import { createLoggerOptions } from "../src/log-redaction.js";
import {
  briefIsDue,
  briefLogFields,
  composeDailyBrief,
  parseBriefPreference,
  readIntegrationSnapshot,
  zonedParts,
  type BriefAssistant,
  type BriefSource,
} from "../src/daily-brief.js";
import {
  generateDailyBriefNow,
  readDailyBrief,
  runDueDailyBriefs,
  saveDailyBriefPreference,
  type DailyBriefRepository,
} from "../src/daily-brief-service.js";

const chat = "decrypted-chat-plaintext-canary-7f3a91c2";
const now = new Date("2026-11-20T06:30:00.000Z");
const boardId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const linaId = "33333333-3333-4333-8333-333333333333";
const omarId = "44444444-4444-4444-8444-444444444444";

const source = {
  plaintext: chat,
  messages: [{ plaintext: chat, ciphertext: chat }],
  transcript: chat,
  calendar: [
    {
      id: boardId,
      externalEventId: "evt-board",
      provider: "google",
      title: "Board review",
      startsAt: "2026-11-20T06:00:00.000Z",
      endsAt: "2026-11-20T07:00:00.000Z",
      allDay: false,
      busy: true,
      plaintext: chat,
    },
    {
      id: clientId,
      externalEventId: "evt-client",
      provider: "google",
      title: "Client call",
      startsAt: "2026-11-20T06:30:00.000Z",
      endsAt: "2026-11-20T07:00:00.000Z",
      allDay: false,
      busy: true,
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      externalEventId: "evt-tomorrow",
      provider: "google",
      title: "Tomorrow planning",
      startsAt: "2026-11-21T06:00:00.000Z",
      endsAt: "2026-11-21T07:00:00.000Z",
      busy: true,
    },
  ],
  mail: [
    {
      id: linaId,
      provider: "gmail",
      fromAddress: "Lina Haddad <lina@acme.com>",
      subject: "Board deck due today",
      snippet: "Need the deck before the board review?",
      receivedAt: "2026-11-20T05:00:00.000Z",
    },
    {
      id: omarId,
      provider: "gmail",
      fromAddress: "omar@client.example",
      subject: "Following up on the proposal",
      snippet: "Can you reply on the numbers?",
      receivedAt: "2026-11-17T06:30:00.000Z",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      provider: "gmail",
      fromAddress: "news@offers.example",
      subject: "50% off desk lamps unsubscribe",
      snippet: "Shop the newsletter",
      receivedAt: "2026-11-20T05:30:00.000Z",
    },
  ],
};

const mockAssistant: BriefAssistant = { mode: "mock" };

function memoryRepo(facts: BriefSource = readIntegrationSnapshot(source)) {
  const prefs = new Map<string, { briefTime: string; language: "en" | "ar"; timeZone: string }>();
  const briefs = new Map<string, { id: string; ownerUserId: string; localDate: string; document: Awaited<ReturnType<typeof composeDailyBrief>> }>();
  const counters = { loads: 0, reads: 0 };
  const repo: DailyBriefRepository = {
    async getPreference(userId) {
      counters.reads += 1;
      return prefs.get(userId) ?? null;
    },
    async savePreference(userId, preference) {
      prefs.set(userId, preference);
      return preference;
    },
    async findBrief(userId, localDate) {
      return briefs.get(`${userId}:${localDate}`) ?? null;
    },
    async saveBrief(input) {
      const stored = {
        id: "brief-row",
        ownerUserId: input.ownerUserId,
        localDate: input.localDate,
        document: input.document,
      };
      briefs.set(`${input.ownerUserId}:${input.localDate}`, stored);
      return stored;
    },
    async listCandidates() {
      return [...prefs.entries()].map(([userId, preference]) => ({ userId, preference }));
    },
    async loadSources() {
      counters.loads += 1;
      return facts;
    },
  };
  return { repo, counters, prefs };
}

describe("daily brief schedule", () => {
  it("uses the account time zone and does not repeat a brief the same local day", () => {
    const morning = new Date("2026-11-20T04:00:00.000Z");
    assert.deepEqual(zonedParts(morning, "Asia/Amman"), {
      date: "2026-11-20",
      hour: 7,
      minute: 0,
    });
    assert.equal(briefIsDue({
      now: new Date("2026-11-20T03:59:00.000Z"),
      timeZone: "Asia/Amman",
      briefTime: "07:00",
      generatedForDate: null,
    }), false);
    assert.equal(briefIsDue({
      now: morning,
      timeZone: "Asia/Amman",
      briefTime: "07:00",
      generatedForDate: null,
    }), true);
    assert.equal(briefIsDue({
      now: morning,
      timeZone: "Asia/Amman",
      briefTime: "07:00",
      generatedForDate: "2026-11-20",
    }), false);
  });

  it("rejects chat fields and invalid brief times", () => {
    assert.equal(parseBriefPreference({ briefTime: "25:00", language: "en", timeZone: "Asia/Amman" }).ok, false);
    assert.equal(parseBriefPreference({
      briefTime: "07:30",
      language: "ar",
      timeZone: "Asia/Amman",
      messages: [{ plaintext: chat }],
    }).ok, false);
    const parsed = parseBriefPreference({
      briefTime: "08:15",
      language: "ar",
      timeZone: "Asia/Amman",
    });
    assert.equal(parsed.ok, true);
  });
});

describe("daily brief composition", () => {
  it("builds a deterministic brief from mail and calendar and drops chat", async () => {
    let called = false;
    const first = await composeDailyBrief({
      now,
      preference: { briefTime: "07:00", language: "en", timeZone: "Asia/Amman" },
      source,
      sourceKind: "morning",
      assistant: {
        mode: "mock",
        complete: async () => {
          called = true;
          throw new Error("mock mode must not call the model");
        },
      },
    });
    const second = await composeDailyBrief({
      now,
      preference: { briefTime: "07:00", language: "en", timeZone: "Asia/Amman" },
      source,
      sourceKind: "morning",
      assistant: mockAssistant,
    });

    assert.equal(called, false);
    assert.equal(first.mode, "mock");
    assert.equal(first.narrative, second.narrative);
    assert.equal(JSON.stringify(first).includes(chat), false);
    assert.deepEqual(first.meetings.map((meeting) => meeting.title), ["Board review", "Client call"]);
    assert.deepEqual(first.meetings[0]?.conflictsWith, ["Client call"]);
    assert.match(first.meetings[0]?.prepNote ?? "", /Lina/);
    assert.equal(first.needsReply[0]?.fromAddress.includes("lina@acme.com"), true);
    assert.equal(first.needsReply[0]?.urgency, "high");
    assert.equal(first.needsReply.some((item) => item.subject.includes("unsubscribe")), false);
    assert.equal(first.overdueFollowUps[0]?.subject, "Following up on the proposal");
    assert.equal(first.overdueFollowUps[0]?.daysOverdue, 3);
    assert.match(first.narrative, /approval/i);
    assert.doesNotMatch(first.narrative, /I sent|I booked|has been sent/i);

    const kinds = first.actions.map((action) => action.kind);
    assert.deepEqual(kinds, ["draft_reply", "reschedule", "decline"]);
    const draft = first.actions[0]?.approval;
    const move = first.actions[1]?.approval;
    const decline = first.actions[2]?.approval;
    assert.equal(draft?.action, "save_draft");
    if (draft?.action === "save_draft") {
      assert.deepEqual(draft.payload.to, ["lina@acme.com"]);
      assert.match(draft.payload.subject, /^Re: /);
    }
    assert.equal(move?.action, "reschedule_event");
    if (move?.action === "reschedule_event") {
      assert.equal(move.payload.startsAt, "2026-11-20T07:00:00.000Z");
      assert.equal(move.payload.endsAt, "2026-11-20T07:30:00.000Z");
    }
    assert.equal(decline?.action, "delete_event");
    if (decline?.action === "delete_event") {
      assert.equal(decline.payload.eventId, clientId);
    }
    assert.equal(first.actions.every((action) => action.approvalRequired), true);
    assert.equal(JSON.stringify(briefLogFields(first)).includes("Board review"), false);
  });

  it("uses a live assistant only for the narrative and still omits chat", async () => {
    const seen: string[] = [];
    const brief = await composeDailyBrief({
      now,
      preference: { briefTime: "07:00", language: "en", timeZone: "Asia/Amman" },
      source,
      sourceKind: "on_demand",
      assistant: {
        mode: "live",
        async complete(input) {
          seen.push(...input.contextLines);
          return "Board review still conflicts. Waiting for approval.";
        },
      },
    });
    assert.equal(brief.mode, "live");
    assert.match(brief.narrative, /approval/);
    assert.equal(seen.some((line) => line.includes("Board review")), true);
    assert.equal(seen.join("\n").includes(chat), false);
    assert.equal(brief.actions[0]?.approval.action, "save_draft");
  });

  it("writes the Arabic brief without claiming a send", async () => {
    const brief = await composeDailyBrief({
      now,
      preference: { briefTime: "07:00", language: "ar", timeZone: "Asia/Amman" },
      source,
      sourceKind: "morning",
      assistant: mockAssistant,
    });
    assert.match(brief.narrative, /موافقتك/);
    assert.match(brief.narrative, /ما انبعت/);
    assert.match(brief.meetings[0]?.prepNote ?? "", /راجع/);
    assert.equal(brief.actions[2]?.approval.action, "delete_event");
  });
});

describe("daily brief service", () => {
  it("stays closed when the flag is off", async () => {
    const { repo, counters } = memoryRepo();
    const result = await readDailyBrief({
      enabled: false,
      userId: "user-a",
      now,
      repo,
      assistant: mockAssistant,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "daily_brief_disabled");
    assert.equal(counters.reads, 0);
    assert.equal(counters.loads, 0);
  });

  it("waits until the brief time, then prepares once and can refresh on demand", async () => {
    const { repo, counters } = memoryRepo();
    const early = await readDailyBrief({
      enabled: true,
      userId: "user-a",
      now: new Date("2026-11-20T03:30:00.000Z"),
      repo,
      assistant: mockAssistant,
    });
    assert.equal(early.ok, true);
    if (early.ok) {
      assert.equal(early.body.brief, null);
      assert.equal(early.body.pendingReason, "before_brief_time");
    }
    assert.equal(counters.loads, 0);

    const activities: string[] = [];
    const morning = await readDailyBrief({
      enabled: true,
      userId: "user-a",
      now,
      repo,
      assistant: mockAssistant,
      recordActivity: async (summary) => {
        activities.push(summary);
      },
    });
    assert.equal(morning.ok, true);
    if (morning.ok) assert.equal(morning.body.brief?.meetings.length, 2);
    assert.equal(activities.includes("Prepared the daily brief"), true);
    assert.equal(counters.loads, 1);

    await readDailyBrief({
      enabled: true,
      userId: "user-a",
      now,
      repo,
      assistant: mockAssistant,
    });
    assert.equal(counters.loads, 1);

    const again = await generateDailyBriefNow({
      enabled: true,
      userId: "user-a",
      now,
      repo,
      assistant: mockAssistant,
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.body.brief?.source, "on_demand");
    assert.equal(counters.loads, 2);
  });

  it("prepares due briefs from the morning pass and skips the same day", async () => {
    const { repo } = memoryRepo();
    await saveDailyBriefPreference({
      enabled: true,
      userId: "user-a",
      body: { briefTime: "07:00", language: "en", timeZone: "Asia/Amman" },
      repo,
    });
    const first = await runDueDailyBriefs({
      enabled: true,
      now,
      repo,
      assistantFor: async () => mockAssistant,
    });
    assert.deepEqual(first, { prepared: 1, skipped: 0, failed: 0 });
    const second = await runDueDailyBriefs({
      enabled: true,
      now,
      repo,
      assistantFor: async () => {
        throw new Error("model must not be required");
      },
    });
    assert.deepEqual(second, { prepared: 0, skipped: 1, failed: 0 });
    const off = await runDueDailyBriefs({
      enabled: false,
      now,
      repo,
      assistantFor: async () => mockAssistant,
    });
    assert.deepEqual(off, { prepared: 0, skipped: 0 });
  });
});

describe("daily brief log redaction", () => {
  it("removes brief narrative, subjects, and snippets from process logs", async () => {
    const narrative = "Board review conflicts with the client call and waits for approval.";
    const subject = "Board deck due today from Lina";
    const snippet = "Need the deck before the board review happens";
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = Fastify({ logger: { ...createLoggerOptions(), stream }, trustProxy: false });
    app.post("/daily-brief-log", async (request) => {
      request.log.info(
        {
          brief: {
            narrative,
            meetings: [{ title: "Board review", prepNote: snippet }],
            needsReply: [{ subject, snippet, fromAddress: "lina@acme.com" }],
          },
          narrative,
          subject,
          snippet,
        },
        `prepared ${narrative} about ${subject}`,
      );
      return { ok: true };
    });
    const response = await app.inject({
      method: "POST",
      url: "/daily-brief-log",
      headers: { "content-type": "application/json" },
      payload: { narrative, subject, snippet },
    });
    assert.equal(response.statusCode, 200);
    await app.close();
    const output = lines.join("\n");
    assert.equal(output.includes(narrative), false, output);
    assert.equal(output.includes(subject), false, output);
    assert.equal(output.includes(snippet), false, output);
    assert.equal(output.includes("lina@acme.com"), false, output);
    assert.match(output, /\[redacted\]/);
  });
});

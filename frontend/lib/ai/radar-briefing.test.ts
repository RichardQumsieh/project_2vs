import { describe, expect, it } from "vitest";
import {
  answerRadarQuestion,
  buildDailyBriefing,
  bumpRadarCounter,
  emptyRadarClientCounters,
  parseRadarClientCounters,
} from "./radar-briefing";
import {
  emptyRadarStoreState,
  type RadarFinding,
  type RadarStoreState,
  type RadarTaskDraft,
} from "./radar-store";

function sampleFinding(
  overrides: Partial<RadarFinding> = {},
): RadarFinding {
  return {
    id: "finding-1",
    conversationId: "conversation-a",
    messageIds: ["message-1"],
    category: "commitment",
    title: "Send proposal to Dana",
    excerpt: "I'll send Dana the proposal tomorrow.",
    dueAt: "2026-11-16",
    committedBy: "self",
    status: "pending",
    createdAt: "2026-11-15T10:00:00.000Z",
    updatedAt: "2026-11-15T10:00:00.000Z",
    ...overrides,
  };
}

function sampleTask(overrides: Partial<RadarTaskDraft> = {}): RadarTaskDraft {
  return {
    id: "task-1",
    findingId: "finding-1",
    conversationId: "conversation-a",
    title: "Send proposal to Dana",
    dueAt: "2026-11-16",
    status: "open",
    createdAt: "2026-11-15T10:00:00.000Z",
    updatedAt: "2026-11-15T10:00:00.000Z",
    ...overrides,
  };
}

function sampleStore(
  overrides: Partial<RadarStoreState> = {},
): RadarStoreState {
  return {
    ...emptyRadarStoreState(),
    allowedConversationIds: ["conversation-a"],
    findings: [sampleFinding()],
    taskDrafts: [sampleTask()],
    ...overrides,
  };
}

describe("radar briefing and Q&A builders", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");

  it("builds a daily briefing from pending findings and due-soon tasks", () => {
    const briefing = buildDailyBriefing(sampleStore(), { now });
    expect(briefing.headline).toContain("2026-11-15");
    expect(briefing.pendingCount).toBe(1);
    expect(briefing.dueSoonCount).toBe(1);
    expect(briefing.lines.join("\n")).toMatch(/pending Radar finding/i);
    expect(briefing.lines.join("\n")).toMatch(/Send proposal to Dana/);
  });

  it("answers outstanding and promise questions from local store only", () => {
    const store = sampleStore({
      findings: [
        sampleFinding({ status: "accepted", taskDraftId: "task-1" }),
        sampleFinding({
          id: "finding-2",
          title: "Peer will ship docs",
          excerpt: "Alex will ship the docs",
          committedBy: "peer",
          status: "pending",
        }),
      ],
    });

    const outstanding = answerRadarQuestion("what's outstanding?", store, {
      now,
      conversationId: "conversation-a",
    });
    expect(outstanding).toMatch(/Daily briefing/i);

    const promised = answerRadarQuestion(
      "what did I promise Dana?",
      store,
      {
        now,
        conversationId: "conversation-a",
        peerUsername: "dana",
      },
    );
    expect(promised).toMatch(/Dana/i);
    expect(promised).toMatch(/Send proposal to Dana/);
    expect(promised).not.toMatch(/Peer will ship docs/);
  });

  it("ignores unrelated chat and reports empty authorized context", () => {
    expect(
      answerRadarQuestion("how is the weather today?", sampleStore(), { now }),
    ).toBeNull();
    expect(
      answerRadarQuestion(
        "what did I promise Morgan?",
        emptyRadarStoreState(),
        { now },
      ),
    ).toMatch(/don't have an authorized local commitment/i);
  });

  it("parses and bumps plaintext-safe client counters", () => {
    expect(parseRadarClientCounters({ findingsProposed: 2.7, junk: true })).toEqual({
      findingsProposed: 2,
      findingsAccepted: 0,
      findingsDismissed: 0,
      briefingsGenerated: 0,
      questionsAnswered: 0,
    });
    expect(
      bumpRadarCounter(emptyRadarClientCounters(), "questionsAnswered", 3)
        .questionsAnswered,
    ).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildBriefingStagedAction,
  buildDeadlineProposals,
  buildRadarSecondaryActions,
  parseDurationMinutes,
  parseEmailAddresses,
  parseGithubRepoRef,
  parseSlackChannelHint,
} from "./sophia-job-tools";
import { emptyRadarStoreState, type RadarFinding, type RadarTaskDraft } from "./radar-store";
import type { RadarBriefing } from "./radar-briefing";

function fixture() {
  const finding: RadarFinding = {
    id: "finding-1",
    conversationId: "conversation-a",
    messageIds: ["message-1"],
    category: "commitment",
    title: "Send proposal to Dana",
    excerpt: "I'll send Dana the proposal tomorrow.",
    dueAt: "2026-11-16",
    committedBy: "self",
    status: "accepted",
    taskDraftId: "task-1",
    createdAt: "2026-11-15T10:00:00.000Z",
    updatedAt: "2026-11-15T10:00:00.000Z",
  };
  const overdue: RadarTaskDraft = {
    id: "task-1",
    findingId: "finding-1",
    conversationId: "conversation-a",
    title: "Send proposal to Dana",
    dueAt: "2026-11-10",
    status: "open",
    createdAt: "2026-11-09T10:00:00.000Z",
    updatedAt: "2026-11-09T10:00:00.000Z",
  };
  const soon: RadarTaskDraft = {
    id: "task-2",
    conversationId: "conversation-a",
    title: "Review deck",
    dueAt: "2026-11-16",
    status: "open",
    createdAt: "2026-11-15T10:00:00.000Z",
    updatedAt: "2026-11-15T10:00:00.000Z",
  };
  return {
    finding,
    store: {
      ...emptyRadarStoreState(),
      allowedConversationIds: ["conversation-a"],
      findings: [finding],
      taskDrafts: [overdue, soon],
    },
  };
}

describe("sophia job-manager helpers", () => {
  it("parses schedule and provider hints from free text", () => {
    expect(parseDurationMinutes("schedule 30m with Dana")).toBe(30);
    expect(parseDurationMinutes("book 2 hours")).toBe(120);
    expect(parseEmailAddresses("draft email to dana@acme.com about X")).toEqual([
      "dana@acme.com",
    ]);
    expect(parseGithubRepoRef("file github issue in acme/ops about login")).toEqual({
      owner: "acme",
      repo: "ops",
    });
    expect(parseSlackChannelHint("draft Slack to #ops summarizing status")).toBe(
      "ops",
    );
  });

  it("builds proactive deadline proposals without executing writes", () => {
    const { store } = fixture();
    const actions = buildDeadlineProposals(store, {
      now: new Date("2026-11-15T12:00:00.000Z"),
      conversationId: "conversation-a",
    });
    expect(actions.map((action) => action.type)).toEqual([
      "reschedule_commitment",
      "propose_follow_up",
    ]);
  });

  it("builds Radar secondary provider proposals from a finding", () => {
    const { finding } = fixture();
    const actions = buildRadarSecondaryActions(finding, {
      calendarProvider: "google",
      githubOwner: "acme",
      githubRepo: "ops",
      linearTeamId: "team_1",
    });
    expect(actions.map((action) => action.type)).toEqual([
      "create_calendar_event",
      "create_github_issue",
      "create_linear_issue",
    ]);
  });

  it("stages briefing lines into follow-up or reschedule actions", () => {
    const { store } = fixture();
    const briefing: RadarBriefing = {
      generatedAt: "2026-11-15T12:00:00.000Z",
      headline: "Daily briefing",
      lines: ["1 task due soon"],
      pendingCount: 0,
      openTaskCount: 2,
      dueSoonCount: 1,
    };
    const follow = buildBriefingStagedAction(briefing, {
      task: store.taskDrafts[1],
      now: new Date("2026-11-15T12:00:00.000Z"),
    });
    expect(follow?.type).toBe("propose_follow_up");
    const reschedule = buildBriefingStagedAction(briefing, {
      task: store.taskDrafts[0],
      now: new Date("2026-11-15T12:00:00.000Z"),
    });
    expect(reschedule?.type).toBe("reschedule_commitment");
  });
});

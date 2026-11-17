import { describe, expect, it } from "vitest";
import { parseSophiaCommand } from "./sophia-planner";
import {
  emptyRadarStoreState,
  type RadarFinding,
  type RadarTaskDraft,
} from "./radar-store";

function radarFixture() {
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
  const task: RadarTaskDraft = {
    id: "task-1",
    findingId: "finding-1",
    conversationId: "conversation-a",
    title: "Send proposal to Dana",
    dueAt: "2026-11-16",
    status: "open",
    createdAt: "2026-11-15T10:00:00.000Z",
    updatedAt: "2026-11-15T10:00:00.000Z",
  };
  return {
    ...emptyRadarStoreState(),
    allowedConversationIds: ["conversation-a"],
    findings: [finding],
    taskDrafts: [task],
  };
}

describe("fast Sophia command planner", () => {
  it("splits a compound Sophia command into permissioned local actions", () => {
    const plan = parseSophiaCommand(
      "Sophia I need to prepare a presentation for my manager next Thursday. I also need to research three competitors and organize a meeting with the team",
      {
        recipientUsername: "teamlead",
        now: new Date("2026-11-13T12:00:00.000Z"),
      },
    );

    expect(plan.addressedToSophia).toBe(true);
    expect(plan.intents.map((intent) => intent.type)).toEqual([
      "create_document",
      "remember_fact",
      "research",
      "create_document",
      "create_document",
      "draft_message",
    ]);
    expect(plan.spokenReply).toContain("approve");
    const presentation = plan.intents.find(
      (intent) =>
        intent.type === "create_document" &&
        intent.document.kind === "presentation",
    );
    expect(presentation?.type === "create_document" && presentation.document.title).toBe(
      "Presentation for manager",
    );
    expect(
      presentation?.type === "create_document" && presentation.document.filename,
    ).toBe("presentation-for-manager.pptx");
    expect(
      presentation?.type === "create_document" && presentation.document.mimeType,
    ).toContain("presentationml");
    expect(
      plan.intents.find((intent) => intent.type === "remember_fact"),
    ).toMatchObject({ fact: "Presentation for manager is due 2026-11-19" });
    expect(
      plan.intents.find((intent) => intent.type === "research"),
    ).toMatchObject({
      query: expect.stringContaining("competitors"),
    });
    const draft = plan.intents.find((intent) => intent.type === "draft_message");
    expect(draft?.type === "draft_message" && draft.body).toMatch(/meet/i);
  });

  it("stays quiet on ordinary chat without a command cue", () => {
    expect(
      parseSophiaCommand("I need to think about this later").intents,
    ).toEqual([]);
  });

  it("remembers and forgets explicit personal notes", () => {
    const remember = parseSophiaCommand(
      "Sophia remember that my manager is Dana",
    );
    expect(remember.intents).toEqual([
      { type: "remember_fact", fact: "my manager is Dana" },
    ]);
    const forget = parseSophiaCommand("forget that Dana");
    expect(forget.intents).toEqual([{ type: "forget_fact", query: "Dana" }]);
  });

  it("answers Radar outstanding and promise questions from local store", () => {
    const outstanding = parseSophiaCommand("Sophia what's outstanding?", {
      radarStore: radarFixture(),
      conversationId: "conversation-a",
      now: new Date("2026-11-15T12:00:00.000Z"),
    });
    expect(outstanding.intents).toHaveLength(1);
    expect(outstanding.intents[0]).toMatchObject({ type: "radar_answer" });
    expect(outstanding.spokenReply).toMatch(/Daily briefing|pending|open/i);

    const promised = parseSophiaCommand("Sophia what did I promise Dana?", {
      radarStore: radarFixture(),
      conversationId: "conversation-a",
      recipientUsername: "dana",
      now: new Date("2026-11-15T12:00:00.000Z"),
    });
    expect(promised.intents[0]).toMatchObject({ type: "radar_answer" });
    expect(promised.spokenReply).toMatch(/Send proposal to Dana/);
  });

  it("does not invent Radar answers without a local store", () => {
    expect(
      parseSophiaCommand("Sophia what's outstanding?").intents,
    ).toEqual([]);
  });
  it("still accepts Jarvis wake-word alias during rename compatibility", () => {
    const plan = parseSophiaCommand(
      "Jarvis remember that my standup is at 10am",
    );
    expect(plan.addressedToSophia).toBe(true);
    expect(plan.intents[0]).toMatchObject({
      type: "remember_fact",
      fact: "my standup is at 10am",
    });
  });

  it("stages job-manager actions from @Sophia compound commands", () => {
    const plan = parseSophiaCommand(
      "@Sophia schedule 30m with Dana Thursday and draft email to dana@acme.com about the proposal; file github issue in acme/ops for the follow-up",
      {
        now: new Date("2026-11-13T12:00:00.000Z"),
        jobDefaults: {
          calendarProvider: "google",
          emailProvider: "gmail",
        },
      },
    );
    expect(plan.addressedToSophia).toBe(true);
    expect(plan.intents.map((intent) => intent.type)).toEqual(
      expect.arrayContaining([
        "create_calendar_event",
        "draft_email",
        "create_github_issue",
      ]),
    );
    expect(plan.spokenReply).toMatch(/approve/i);
    const calendar = plan.intents.find(
      (intent) => intent.type === "create_calendar_event",
    );
    expect(calendar).toMatchObject({
      type: "create_calendar_event",
      title: "30m with Dana",
      provider: "google",
    });
    const email = plan.intents.find((intent) => intent.type === "draft_email");
    expect(email).toMatchObject({
      type: "draft_email",
      to: ["dana@acme.com"],
    });
  });

  it("stages Linear, Slack, follow-up, and reschedule with defaults and local Radar", () => {
    const follow = parseSophiaCommand("Sophia follow up on the vendor quote Friday", {
      now: new Date("2026-11-13T12:00:00.000Z"),
    });
    expect(follow.intents[0]).toMatchObject({
      type: "propose_follow_up",
      dueAt: "2026-11-20",
    });

    const slack = parseSophiaCommand(
      "Sophia draft Slack to #ops summarizing the launch checklist",
      {
        jobDefaults: {
          slackChannelId: "C01ABCDEF",
          slackChannelName: "ops",
        },
      },
    );
    expect(slack.intents[0]).toMatchObject({
      type: "post_slack_message",
      channelId: "C01ABCDEF",
      channelName: "ops",
    });

    const linear = parseSophiaCommand("Sophia file Linear for the onboarding blocker", {
      jobDefaults: { linearTeamId: "team_abc" },
    });
    expect(linear.intents[0]).toMatchObject({
      type: "create_linear_issue",
      teamId: "team_abc",
    });

    const reschedule = parseSophiaCommand("Sophia reschedule the proposal to Friday", {
      radarStore: radarFixture(),
      now: new Date("2026-11-13T12:00:00.000Z"),
    });
    expect(reschedule.intents[0]).toMatchObject({
      type: "reschedule_commitment",
      taskDraftId: "task-1",
      dueAt: "2026-11-20",
    });
  });

});

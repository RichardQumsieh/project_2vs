import { describe, expect, it } from "vitest";
import { parseJarvisCommand } from "./jarvis-planner";
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

describe("fast Jarvis command planner", () => {
  it("splits a compound Jarvis command into permissioned local actions", () => {
    const plan = parseJarvisCommand(
      "Jarvis I need to prepare a presentation for my manager next Thursday. I also need to research three competitors and organize a meeting with the team",
      {
        recipientUsername: "teamlead",
        now: new Date("2026-11-13T12:00:00.000Z"),
      },
    );

    expect(plan.addressedToJarvis).toBe(true);
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
      parseJarvisCommand("I need to think about this later").intents,
    ).toEqual([]);
  });

  it("remembers and forgets explicit personal notes", () => {
    const remember = parseJarvisCommand(
      "Jarvis remember that my manager is Dana",
    );
    expect(remember.intents).toEqual([
      { type: "remember_fact", fact: "my manager is Dana" },
    ]);
    const forget = parseJarvisCommand("forget that Dana");
    expect(forget.intents).toEqual([{ type: "forget_fact", query: "Dana" }]);
  });

  it("answers Radar outstanding and promise questions from local store", () => {
    const outstanding = parseJarvisCommand("Jarvis what's outstanding?", {
      radarStore: radarFixture(),
      conversationId: "conversation-a",
      now: new Date("2026-11-15T12:00:00.000Z"),
    });
    expect(outstanding.intents).toHaveLength(1);
    expect(outstanding.intents[0]).toMatchObject({ type: "radar_answer" });
    expect(outstanding.spokenReply).toMatch(/Daily briefing|pending|open/i);

    const promised = parseJarvisCommand("Jarvis what did I promise Dana?", {
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
      parseJarvisCommand("Jarvis what's outstanding?").intents,
    ).toEqual([]);
  });
});

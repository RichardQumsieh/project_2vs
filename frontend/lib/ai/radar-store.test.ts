import { describe, expect, it } from "vitest";
import {
  acceptFindingAsTaskDraft,
  dismissFinding,
  emptyRadarStoreState,
  isConversationAllowed,
  listPendingFindings,
  parseRadarStoreState,
  radarStoreUserKey,
  setConversationAllowed,
  snoozeFinding,
  upsertFindings,
  type RadarFinding,
} from "./radar-store";

function sampleFinding(
  overrides: Partial<RadarFinding> = {},
): RadarFinding {
  return {
    id: "finding-1",
    conversationId: "conversation-a",
    messageIds: ["message-1"],
    category: "commitment",
    title: "Send proposal",
    excerpt: "I'll send the proposal tomorrow.",
    dueAt: "2026-11-16",
    committedBy: "self",
    status: "pending",
    createdAt: "2026-11-15T10:00:00.000Z",
    updatedAt: "2026-11-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("radar store state helpers", () => {
  it("keys IndexedDB Radar state per user and rejects empty keys", () => {
    expect(radarStoreUserKey("user-a")).toBe("user-a");
    expect(radarStoreUserKey("user-b")).toBe("user-b");
    expect(radarStoreUserKey("user-a")).not.toBe(radarStoreUserKey("user-b"));
    expect(radarStoreUserKey("   ")).toBe("");
  });

  it("isolates allowlists and rejects malformed persisted payloads", () => {
    const allowed = setConversationAllowed(
      emptyRadarStoreState(),
      "conversation-a",
      true,
    );
    expect(isConversationAllowed(allowed, "conversation-a")).toBe(true);
    expect(isConversationAllowed(allowed, "conversation-b")).toBe(false);
    expect(
      parseRadarStoreState({
        version: 1,
        allowedConversationIds: ["ok", "", 12],
        findings: [{ id: "bad" }],
        taskDrafts: "nope",
      }).allowedConversationIds,
    ).toEqual(["ok"]);
  });

  it("keeps accepted findings from being overwritten by rescans", () => {
    const accepted = acceptFindingAsTaskDraft(
      upsertFindings(emptyRadarStoreState(), [sampleFinding()]),
      "finding-1",
      { id: "task-1", now: new Date("2026-11-15T12:00:00.000Z") },
    );
    const rescanned = upsertFindings(accepted, [
      sampleFinding({
        title: "Changed by rescanner",
        updatedAt: "2026-11-15T13:00:00.000Z",
      }),
    ]);
    expect(rescanned.findings[0]?.status).toBe("accepted");
    expect(rescanned.findings[0]?.title).toBe("Send proposal");
    expect(rescanned.taskDrafts[0]?.title).toBe("Send proposal");
  });

  it("supports dismiss and snooze pending lifecycle", () => {
    const pending = upsertFindings(emptyRadarStoreState(), [sampleFinding()]);
    const dismissed = dismissFinding(
      pending,
      "finding-1",
      new Date("2026-11-15T12:00:00.000Z"),
    );
    expect(listPendingFindings(dismissed)).toHaveLength(0);

    const snoozed = snoozeFinding(
      pending,
      "finding-1",
      "2026-11-16T12:00:00.000Z",
      new Date("2026-11-15T12:00:00.000Z"),
    );
    expect(
      listPendingFindings(snoozed, "conversation-a", new Date("2026-11-15T13:00:00.000Z")),
    ).toHaveLength(0);
    expect(
      listPendingFindings(snoozed, "conversation-a", new Date("2026-11-16T13:00:00.000Z")),
    ).toHaveLength(1);
  });
});

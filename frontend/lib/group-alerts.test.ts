import { describe, expect, it } from "vitest";
import { groupAlertDecision } from "./group-alerts";

describe("group notifications", () => {
  it("notifies for an application when the thread is not the open page", () => {
    expect(groupAlertDecision({
      kind: "application",
      conversationId: "group-a",
      activeConversationId: "group-b",
      pageVisible: true,
    })).toBe(true);
    expect(groupAlertDecision({
      kind: "application",
      conversationId: "group-a",
      activeConversationId: "group-a",
      pageVisible: false,
    })).toBe(true);
  });

  it("stays quiet for commits and for the group already on screen", () => {
    expect(groupAlertDecision({
      kind: "commit",
      conversationId: "group-a",
      activeConversationId: null,
      pageVisible: true,
    })).toBe(false);
    expect(groupAlertDecision({
      kind: "application",
      conversationId: "group-a",
      activeConversationId: "group-a",
      pageVisible: true,
    })).toBe(false);
    expect(groupAlertDecision({
      kind: undefined,
      conversationId: "group-a",
      activeConversationId: null,
      pageVisible: true,
    })).toBe(false);
  });
});

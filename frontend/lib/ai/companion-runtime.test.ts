import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalMessage } from "../crypto/types";
import {
  classifyCompanionMessage,
  createCompanionRuntime,
  type CompanionObservation,
} from "./companion-runtime";

function message(
  id: string,
  conversationId: string,
  plaintext: string,
  fromMe = false,
): LocalMessage {
  return {
    id,
    conversationId,
    senderDeviceId: "device",
    fromMe,
    plaintext,
    createdAt: `2026-10-26T01:00:${id.padStart(2, "0")}Z`,
  };
}

function setup(debounceMs = 20) {
  const observations: CompanionObservation[] = [];
  const states: string[] = [];
  const messageEvents: Array<{ type: string; messageId: string }> = [];
  const runtime = createCompanionRuntime({
    debounceMs,
    onObservation: (observation) => observations.push(observation),
    onStateChange: (state) => states.push(state),
    onMessageEvent: (event) =>
      messageEvents.push({ type: event.type, messageId: event.messageId }),
  });
  runtime.dispatch({
    type: "settings-updated",
    settings: {
      enabled: true,
      proactiveObservations: true,
      mode: "interactive",
      language: "auto",
    },
  });
  runtime.dispatch({
    type: "messages-loaded",
    conversationId: "chat-a",
    messages: [message("1", "chat-a", "Earlier context?")],
  });
  return { runtime, observations, states, messageEvents };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("autonomous companion runtime", () => {
  it("stays quiet for routine messages and only flags meaningful categories", () => {
    expect(classifyCompanionMessage(message("a", "chat-a", "whatsapp"))).toBeNull();
    expect(classifyCompanionMessage(message("b", "chat-a", "Are we still meeting?"))).toBe("question");
    expect(classifyCompanionMessage(message("c", "chat-a", "Let's meet tomorrow"))).toBe("coordination");
    expect(classifyCompanionMessage(message("d", "chat-a", "I feel unsafe"))).toBe("sensitive");
  });

  it("debounces bursts into one observation and deduplicates repeated snapshots", async () => {
    const harness = setup();
    const incoming = [
      message("2", "chat-a", "Can we move the meeting to Friday?"),
      message("3", "chat-a", "What time works for you?"),
    ];
    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [message("1", "chat-a", "Earlier context?"), ...incoming],
    });
    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [message("1", "chat-a", "Earlier context?"), ...incoming],
    });

    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(harness.observations).toHaveLength(1);
    expect(harness.observations[0]).toMatchObject({
      category: "question",
      messageIds: ["2", "3"],
    });
    expect(harness.messageEvents).toEqual([
      { type: "incoming-message", messageId: "2" },
      { type: "incoming-message", messageId: "3" },
    ]);
    harness.runtime.dispose();
  });

  it("does not observe initial history, muted mode, or disabled proactive controls", async () => {
    const harness = setup();
    harness.runtime.dispatch({
      type: "settings-updated",
      settings: {
        enabled: true,
        proactiveObservations: true,
        mode: "quiet",
        language: "auto",
      },
    });
    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [
        message("1", "chat-a", "Earlier context?"),
        message("2", "chat-a", "What time works for you?"),
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(harness.observations).toHaveLength(0);
    expect(harness.states.at(-1)).toBe("muted");
    harness.runtime.dispose();
  });

  it("uses the preferred or incoming message language for a fixed observation", async () => {
    const harness = setup();
    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [
        message("1", "chat-a", "Earlier context?"),
        message("2", "chat-a", "ممكن نأجل لبكرا؟"),
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(harness.observations[0]?.text).toContain("في سؤال بالمحادثة");
    harness.runtime.dispose();
  });

  it("cancels pending observations after an outgoing reply or conversation switch", async () => {
    const harness = setup(100);
    const prior = message("1", "chat-a", "Earlier context?");
    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [prior, message("2", "chat-a", "Can we talk?")],
    });
    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [
        prior,
        message("2", "chat-a", "Can we talk?"),
        message("3", "chat-a", "Yes, I can call now.", true),
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(harness.observations).toHaveLength(0);

    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [
        prior,
        message("2", "chat-a", "Can we talk?"),
        message("3", "chat-a", "Yes, I can call now.", true),
        message("4", "chat-a", "What time should we meet?"),
      ],
    });
    harness.runtime.dispatch({
      type: "conversation-selected",
      conversationId: "chat-b",
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(harness.observations).toHaveLength(0);
    harness.runtime.dispose();
  });

  it("cancels a queued observation when the user pauses proactive presence", async () => {
    const harness = setup(100);
    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [
        message("1", "chat-a", "Earlier context?"),
        message("2", "chat-a", "Can we meet tomorrow?"),
      ],
    });
    harness.runtime.dispatch({
      type: "settings-updated",
      settings: {
        enabled: true,
        proactiveObservations: false,
        mode: "interactive",
        language: "auto",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(harness.observations).toHaveLength(0);
    expect(harness.states.at(-1)).toBe("muted");
    harness.runtime.dispose();
  });

  it("returns from drafting to the current resting state", () => {
    vi.useFakeTimers();
    const harness = setup();
    harness.runtime.dispatch({
      type: "activity-updated",
      state: "drafting",
    });
    expect(harness.states.at(-1)).toBe("drafting");
    vi.advanceTimersByTime(1_500);
    expect(harness.states.at(-1)).toBe("idle");
    harness.runtime.dispose();
  });

  it("does not let an old observation timer overwrite current companion activity", () => {
    vi.useFakeTimers();
    const harness = setup(50);
    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [
        message("1", "chat-a", "Earlier context?"),
        message("2", "chat-a", "Can you help me decide?"),
      ],
    });
    vi.advanceTimersByTime(50);
    expect(harness.states.at(-1)).toBe("observing");
    harness.runtime.dispatch({
      type: "activity-updated",
      state: "thinking",
    });
    vi.advanceTimersByTime(2_500);
    expect(harness.states.at(-1)).toBe("thinking");
    harness.runtime.dispose();
  });

  it("keeps message-event callbacks free of plaintext and releases pending work on dispose", async () => {
    const harness = setup(100);
    harness.runtime.dispatch({
      type: "messages-loaded",
      conversationId: "chat-a",
      messages: [
        message("1", "chat-a", "Earlier context?"),
        message("2", "chat-a", "Could we meet tomorrow?"),
      ],
    });
    harness.runtime.dispose();
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(harness.observations).toHaveLength(0);
    expect(harness.messageEvents).toEqual([
      { type: "incoming-message", messageId: "2" },
    ]);
    expect(JSON.stringify(harness.messageEvents)).not.toContain("tomorrow");
  });
});

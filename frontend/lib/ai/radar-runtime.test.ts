import { afterEach, describe, expect, it, vi } from "vitest";
import { createRadarRuntime } from "./radar-runtime";
import type { LocalMessage } from "../crypto/types";

function message(
  overrides: Partial<LocalMessage> & Pick<LocalMessage, "id" | "plaintext">,
): LocalMessage {
  return {
    conversationId: "c1",
    senderDeviceId: "device",
    fromMe: true,
    createdAt: "2026-11-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("radar runtime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not emit findings until analysis is enabled and the thread is allowed", () => {
    vi.useFakeTimers();
    const onFindings = vi.fn();
    const runtime = createRadarRuntime({ onFindings, debounceMs: 50 });
    runtime.dispatch({ type: "mount" });
    runtime.dispatch({
      type: "conversation-selected",
      conversationId: "c1",
    });
    runtime.dispatch({
      type: "settings-updated",
      settings: { enabled: false, conversationAllowed: false },
    });
    runtime.dispatch({
      type: "messages-loaded",
      conversationId: "c1",
      messages: [
        message({
          id: "m1",
          plaintext: "I'll send the contract tomorrow.",
        }),
      ],
    });
    vi.advanceTimersByTime(100);
    expect(onFindings).not.toHaveBeenCalled();

    runtime.dispatch({
      type: "settings-updated",
      settings: { enabled: true, conversationAllowed: true },
    });
    runtime.dispatch({
      type: "messages-loaded",
      conversationId: "c1",
      messages: [
        message({
          id: "m1",
          plaintext: "I'll send the contract tomorrow.",
        }),
        message({
          id: "m2",
          plaintext: "I'll also prepare the slides by Friday.",
          createdAt: "2026-11-15T10:05:00.000Z",
        }),
      ],
    });
    vi.advanceTimersByTime(100);
    expect(onFindings).toHaveBeenCalled();
    const findings = onFindings.mock.calls.at(-1)?.[0] ?? [];
    expect(findings.some((finding: { messageIds: string[] }) =>
      finding.messageIds.includes("m2"),
    )).toBe(true);
    runtime.dispose();
  });
});

import { describe, expect, it } from "vitest";
import { dedupeLogicalMessages } from "./logical-messages";

describe("logical message deduplication", () => {
  it("shows one bubble for multiple encrypted device envelopes", () => {
    const messages = [
      {
        id: "wire-a",
        logicalMessageId: "logical-1",
        createdAt: "2026-11-01T10:00:00.000Z",
        plaintext: "same message",
      },
      {
        id: "wire-b",
        logicalMessageId: "logical-1",
        createdAt: "2026-11-01T10:00:00.000Z",
        plaintext: "same message",
      },
      {
        id: "wire-c",
        logicalMessageId: "logical-2",
        createdAt: "2026-11-01T10:01:00.000Z",
        plaintext: "next message",
      },
    ];

    expect(dedupeLogicalMessages(messages)).toEqual([
      messages[0],
      messages[2],
    ]);
  });

  it("preserves messages with no logical ID using their wire IDs", () => {
    const messages = [
      { id: "legacy-a", createdAt: "2026-11-01T10:00:00.000Z" },
      { id: "legacy-b", createdAt: "2026-11-01T10:00:00.000Z" },
    ];

    expect(dedupeLogicalMessages(messages)).toEqual(messages);
  });

  it("merges an existing local echo with its later device-envelope copy", () => {
    const sentMessage = {
      id: "logical-1",
      createdAt: "2026-11-01T10:00:00.000Z",
      plaintext: "sent locally",
    };
    const deviceCopy = {
      id: "wire-copy",
      logicalMessageId: "logical-1",
      createdAt: "2026-11-01T10:00:00.000Z",
      plaintext: "sent locally",
    };

    expect(dedupeLogicalMessages([sentMessage, deviceCopy])).toEqual([
      sentMessage,
    ]);
  });
});

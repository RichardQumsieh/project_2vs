import { describe, expect, it } from "vitest";
import { encodeSystemPayload, encodeWaitingPayload } from "./chat-payload";
import type { LocalMessage } from "./crypto/types";
import {
  applyMention,
  buildGroupRows,
  memberColor,
  mentionQuery,
  mentionSuggestions,
  readByLabel,
  readersOfMessage,
  typingLabel,
} from "./group-presentation";

function message(partial: Partial<LocalMessage> & Pick<LocalMessage, "id" | "plaintext" | "createdAt">): LocalMessage {
  return {
    conversationId: "group",
    senderDeviceId: "device",
    fromMe: false,
    senderUserId: "user-b",
    ...partial,
  };
}

describe("group presentation", () => {
  it("keeps a stable color per member", () => {
    expect(memberColor("alice")).toBe(memberColor("alice"));
    expect(memberColor("alice")).not.toBe(memberColor("bob"));
  });

  it("groups runs, separates days, and lifts system events out of bubbles", () => {
    const rows = buildGroupRows([
      message({ id: "1", plaintext: "hello", createdAt: "2026-01-02T10:00:00.000Z", senderUserId: "bob" }),
      message({ id: "2", plaintext: "again", createdAt: "2026-01-02T10:01:00.000Z", senderUserId: "bob" }),
      message({
        id: "3",
        plaintext: encodeSystemPayload({ event: "added", actor: "Ada", target: "Bea" }),
        createdAt: "2026-01-02T10:02:00.000Z",
      }),
      message({ id: "4", plaintext: "next day", createdAt: "2026-01-03T10:00:00.000Z", senderUserId: "bea" }),
    ], new Date("2026-01-03T12:00:00.000Z"));
    expect(rows.map((row) => row.kind)).toEqual(["date", "message", "message", "system", "date", "message"]);
    const first = rows[1];
    const second = rows[2];
    expect(first?.kind).toBe("message");
    expect(second?.kind).toBe("message");
    if (first?.kind === "message" && second?.kind === "message") {
      expect(first.showSender).toBe(true);
      expect(first.cluster).toBe("first");
      expect(second.showSender).toBe(false);
      expect(second.cluster).toBe("last");
    }
    expect(rows.find((row) => row.kind === "system")).toMatchObject({ text: "Ada added Bea" });
  });

  it("shows who has actually read, and nothing when cursors are absent", () => {
    const messageRef = { id: "m", createdAt: "2026-01-02T10:00:00.000Z", senderUserId: "ada" };
    expect(readersOfMessage(messageRef, [{ userId: "bea", username: "bea" }], "ada")).toEqual([]);
    const names = readersOfMessage(messageRef, [
      { userId: "ada", username: "ada", readCursor: { blobId: "z", createdAt: "2026-01-02T11:00:00.000Z" } },
      { userId: "bea", username: "bea", displayName: "Bea", readCursor: { blobId: "z", createdAt: "2026-01-02T11:00:00.000Z" } },
      { userId: "cy", username: "cy", readCursor: null },
    ], "ada");
    expect(names).toEqual(["Bea"]);
    expect(readByLabel(names)).toBe("Read by Bea");
  });

  it("completes @mentions from the member list", () => {
    const query = mentionQuery("hello @be", 9);
    expect(query).toEqual({ query: "be", start: 6 });
    expect(mentionSuggestions([
      { username: "bea", displayName: "Bea" },
      { username: "ada" },
    ], "be", "ada").map((member) => member.username)).toEqual(["bea"]);
    expect(applyMention("hello @be", 6, 9, "bea").text).toBe("hello @bea ");
  });

  it("names who is typing", () => {
    expect(typingLabel(["Ada"])).toBe("Ada is typing");
    expect(typingLabel(["Ada", "Bea"])).toBe("Ada and Bea are typing");
  });

  it("renders a waiting placeholder as its own row kind via plaintext", () => {
    const rows = buildGroupRows([
      message({ id: "w", plaintext: encodeWaitingPayload({ id: "w" }), createdAt: "2026-01-02T10:00:00.000Z" }),
    ], new Date("2026-01-02T12:00:00.000Z"));
    expect(rows.some((row) => row.kind === "message")).toBe(true);
  });
});

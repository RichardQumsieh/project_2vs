import { describe, expect, it } from "vitest";
import { outgoingTextDestination } from "./chat-route";
import { isSophiaAddressed, parseSophiaCommand } from "./sophia-planner";

describe("friend chat versus the Sophia assistant", () => {
  it("sends invite links that mention sophia as normal chat", () => {
    const link = "Join me https://sophia.apps.grok.bot/join?code=abcd2345efgh";
    expect(outgoingTextDestination("composer")).toBe("chat");
    expect(isSophiaAddressed(link)).toBe(false);
    expect(parseSophiaCommand(link).intents).toEqual([]);
    expect(isSophiaAddressed("sophia.apps.grok.bot/workspaces/invite")).toBe(false);
  });

  it("still recognizes an explicit Sophia greeting outside a bare link", () => {
    expect(isSophiaAddressed("Sophia, what's left today")).toBe(true);
    expect(outgoingTextDestination("assistant")).toBe("assistant");
  });
});

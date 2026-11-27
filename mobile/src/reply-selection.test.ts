import { describe, expect, it } from "vitest";
import { encodeReplyPayload, maxReplyRefs, parseChatPayload } from "../../frontend/lib/chat-payload";
import { addReplyTarget, encodeMultiQuote, quoteRefs, removeReplyTarget, toggleReplyTarget } from "./reply-selection";

const messages = [
  { id: "m1", logicalMessageId: "m1", plaintext: "Can we meet?", fromMe: false },
  { id: "m2", logicalMessageId: "m2", plaintext: "Photo", fromMe: true },
  { id: "m3", plaintext: "Bring the notes", fromMe: false },
];

describe("multi-quote replies", () => {
  it("quotes several messages in one reply and keeps each removable", () => {
    let ids = addReplyTarget([], "m1");
    ids = addReplyTarget(ids, "m2");
    ids = addReplyTarget(ids, "m1");
    expect(ids).toEqual(["m1", "m2"]);
    ids = removeReplyTarget(ids, "m1");
    const encoded = encodeMultiQuote(messages, ids, "Yes — after lunch.");
    expect(parseChatPayload(encoded)).toEqual({
      type: "reply",
      refs: [{ id: "m2", preview: "Photo", fromMe: true }],
      body: "Yes — after lunch.",
    });
  });

  it("still reads a single-quote reply from older clients", () => {
    const encoded = encodeReplyPayload({
      refs: [{ id: "legacy", preview: "Earlier note", fromMe: false }],
      body: "On my way.",
    });
    const parsed = parseChatPayload(encoded);
    expect(parsed.type).toBe("reply");
    if (parsed.type === "reply") expect(parsed.refs).toHaveLength(1);
  });

  it("stops at the shared quote limit", () => {
    const ids = Array.from({ length: maxReplyRefs + 2 }, (_, index) => `id-${index}`);
    const capped = ids.reduce<string[]>((current, id) => addReplyTarget(current, id), []);
    expect(capped).toHaveLength(maxReplyRefs);
    expect(toggleReplyTarget(capped, capped[0]!).includes(capped[0]!)).toBe(false);
  });

  it("drops unknown messages instead of sending an empty quote", () => {
    expect(quoteRefs(messages, ["missing"])).toEqual([]);
    expect(() => encodeMultiQuote(messages, ["missing"], "Hello")).toThrow(/at least one message/);
    expect(() => encodeMultiQuote(messages, ["m3"], "  ")).toThrow(/Write a reply/);
  });
});

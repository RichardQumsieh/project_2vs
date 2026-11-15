import { describe, expect, it } from "vitest";
import { extractRadarFindings } from "./radar-extractor";

describe("radar heuristic extractor", () => {
  it("extracts self commitments and peer deadlines from decrypted text", () => {
    const findings = extractRadarFindings({
      conversationId: "c1",
      now: new Date("2026-11-15T12:00:00.000Z"),
      messages: [
        {
          id: "m1",
          conversationId: "c1",
          fromMe: true,
          plaintext: "I'll send the revised proposal tomorrow.",
          createdAt: "2026-11-15T10:00:00.000Z",
        },
        {
          id: "m2",
          conversationId: "c1",
          fromMe: false,
          plaintext: "Please deliver the invoice by Friday.",
          createdAt: "2026-11-15T11:00:00.000Z",
        },
        {
          id: "m3",
          conversationId: "c1",
          fromMe: false,
          plaintext: "ok",
          createdAt: "2026-11-15T11:01:00.000Z",
        },
      ],
    });
    expect(findings.map((finding) => finding.category).sort()).toEqual([
      "commitment",
      "deadline",
    ]);
    expect(findings.every((finding) => finding.status === "pending")).toBe(true);
    expect(findings.some((finding) => finding.dueAt === "2026-11-16")).toBe(true);
    expect(findings.some((finding) => finding.dueAt === "2026-11-20")).toBe(true);
  });

  it("ignores media payloads and empty chatter", () => {
    expect(
      extractRadarFindings({
        conversationId: "c1",
        messages: [
          {
            id: "img",
            conversationId: "c1",
            fromMe: false,
            plaintext: "PM1IMG:opaque",
            createdAt: "2026-11-15T10:00:00.000Z",
          },
          {
            id: "short",
            conversationId: "c1",
            fromMe: true,
            plaintext: "yes",
            createdAt: "2026-11-15T10:01:00.000Z",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("surfaces unresolved peer questions", () => {
    const findings = extractRadarFindings({
      conversationId: "c1",
      messages: [
        {
          id: "q1",
          conversationId: "c1",
          fromMe: false,
          plaintext: "Did you confirm the venue yet?",
          createdAt: "2026-11-15T10:00:00.000Z",
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("question");
    expect(findings[0]?.committedBy).toBe("peer");
  });
});

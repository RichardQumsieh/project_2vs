import { describe, expect, it } from "vitest";
import {
  buildMeetingAgendaDocument,
  buildPresentationDocument,
  buildResearchBriefDocument,
  generatePresentationPptx,
  inferPresentationSubject,
  pptxMimeType,
  sanitizeDocumentFilename,
} from "./jarvis-documents";

describe("Jarvis local documents", () => {
  it("builds a PowerPoint presentation spec instead of Markdown", async () => {
    const document = buildPresentationDocument({
      title: "Presentation for manager!",
      audience: "manager",
      due: "2026-11-19",
      notes: "prepare a presentation about product launch",
    });
    expect(document.filename).toBe("presentation-for-manager.pptx");
    expect(document.mimeType).toBe(pptxMimeType);
    expect(document.presentation?.subject).toMatch(/product/i);
    expect(document.body).toContain("Slides:");
    expect(sanitizeDocumentFilename("../secret", "pptx")).toBe("secret.pptx");

    const base64 = await generatePresentationPptx(document.presentation!);
    expect(base64.length).toBeGreaterThan(1_000);
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("builds competitor and meeting templates", () => {
    const brief = buildResearchBriefDocument({
      title: "Competitor research brief",
      subjects: ["Northwind", "Contoso"],
      query: "Northwind vs Contoso competitors overview",
    });
    expect(brief.body).toContain("## 1. Northwind");
    expect(brief.body).toContain("Northwind vs Contoso");
    const agenda = buildMeetingAgendaDocument({
      title: "Team meeting agenda",
      when: "2026-11-19",
      attendees: "the team",
    });
    expect(agenda.body).toContain("the team");
    expect(agenda.kind).toBe("agenda");
    expect(inferPresentationSubject({ title: "AI assistant brief" })).toMatch(
      /intelligent assistance/i,
    );
  });
});

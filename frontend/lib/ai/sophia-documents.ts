import PptxGenJS from "pptxgenjs";

export type SophiaDocumentKind =
  | "presentation"
  | "brief"
  | "agenda"
  | "notes";

export const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation" as const;

export type SophiaDocumentMime =
  | "text/markdown"
  | "text/plain"
  | typeof pptxMimeType;

export type PresentationSpec = {
  title: string;
  audience: string;
  due: string;
  subject: string;
  notes: string;
};

export type SophiaDocument = {
  kind: SophiaDocumentKind;
  title: string;
  filename: string;
  mimeType: SophiaDocumentMime;
  body: string;
  presentation?: PresentationSpec;
};

const maxTitleLength = 120;
const maxBodyLength = 80_000;
const maxPptxBase64Length = 3_500_000;

export function sanitizeDocumentTitle(title: string) {
  const cleaned = title.replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
  return cleaned.slice(0, maxTitleLength) || "Untitled note";
}

export function sanitizeDocumentFilename(title: string, extension = "md") {
  const slug = sanitizeDocumentTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const ext = extension.replace(/^\./, "").toLowerCase() || "md";
  return `${slug || "sophia-note"}.${ext}`;
}

export function inferPresentationSubject(input: {
  title: string;
  audience?: string;
  notes?: string;
}) {
  const haystack = [input.title, input.audience, input.notes]
    .filter(Boolean)
    .join(" ");
  const about = haystack.match(
    /\b(?:about|on|regarding|for)\s+([A-Za-z][A-Za-z0-9 &\-/]{2,60})/i,
  );
  if (about?.[1] && !/^(my|the|a|an|manager|team)\b/i.test(about[1])) {
    return about[1].trim();
  }
  if (/\b(product|roadmap|launch)\b/i.test(haystack)) {
    return "product strategy and launch readiness";
  }
  if (/\b(sales|revenue|pipeline)\b/i.test(haystack)) {
    return "revenue growth systems";
  }
  if (/\b(security|privacy|encryption)\b/i.test(haystack)) {
    return "privacy-preserving systems";
  }
  if (/\b(ai|assistant|automation|sophia|jarvis)\b/i.test(haystack)) {
    return "on-device intelligent assistance";
  }
  return input.audience?.trim()
    ? `advanced capabilities for ${input.audience.trim()}`
    : "next-generation operating capability";
}

function presentationPreview(spec: PresentationSpec) {
  return [
    `${spec.title}.pptx`,
    `Audience: ${spec.audience}`,
    `Due: ${spec.due}`,
    `Subject focus: ${spec.subject}`,
    "",
    "Slides:",
    "1. Title & decision ask",
    "2. Why advanced technology matters now",
    "3. Capability stack",
    "4. Architecture & workflow",
    "5. Proof points & outcomes",
    "6. Risks, controls, open questions",
    "7. Ask and next steps",
    spec.notes ? `\nSource notes: ${spec.notes.slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildPresentationDocument(input: {
  title: string;
  audience?: string;
  due?: string;
  notes?: string;
}): SophiaDocument {
  const title = sanitizeDocumentTitle(input.title);
  const audience = input.audience?.trim() || "your audience";
  const due = input.due?.trim() || "the requested date";
  const notes = input.notes?.trim() || "";
  const subject = inferPresentationSubject({ title, audience, notes });
  const presentation: PresentationSpec = {
    title,
    audience,
    due,
    subject,
    notes,
  };
  return {
    kind: "presentation",
    title,
    filename: sanitizeDocumentFilename(title, "pptx"),
    mimeType: pptxMimeType,
    body: presentationPreview(presentation).slice(0, maxBodyLength),
    presentation,
  };
}

export async function generatePresentationPptx(
  spec: PresentationSpec,
): Promise<string> {
  const pptx = new PptxGenJS();
  pptx.author = "Sophia";
  pptx.title = spec.title;
  pptx.subject = spec.subject;
  pptx.company = "Private Messenger";

  const ink = "0F172A";
  const slate = "1E293B";
  const mist = "E2E8F0";
  const accent = "38BDF8";
  const gold = "F59E0B";

  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: ink };
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.18,
    h: 5.4,
    fill: { color: accent },
  });
  titleSlide.addText("SOPHIA · LOCAL BRIEFING DECK", {
    x: 0.6,
    y: 0.55,
    w: 8.5,
    h: 0.35,
    fontSize: 12,
    color: accent,
    bold: true,
    fontFace: "Calibri",
  });
  titleSlide.addText(spec.title, {
    x: 0.6,
    y: 1.4,
    w: 8.5,
    h: 1.2,
    fontSize: 34,
    color: "FFFFFF",
    bold: true,
    fontFace: "Calibri",
  });
  titleSlide.addText(
    [
      { text: `Audience: ${spec.audience}`, options: { breakLine: true } },
      { text: `Target date: ${spec.due}`, options: { breakLine: true } },
      {
        text: `Technology focus: ${spec.subject}`,
        options: { breakLine: true },
      },
    ],
    {
      x: 0.6,
      y: 3.1,
      w: 8.5,
      h: 1.4,
      fontSize: 16,
      color: mist,
      fontFace: "Calibri",
    },
  );

  const why = pptx.addSlide();
  why.background = { color: "0B1220" };
  why.addText("Why advanced technology now", {
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 0.5,
    fontSize: 26,
    color: "FFFFFF",
    bold: true,
  });
  why.addText(
    [
      {
        text: `Center the conversation on ${spec.subject} as a practical operating advantage, not a novelty.`,
        options: { breakLine: true },
      },
      {
        text: "Lead with decision speed, evidence quality, and controlled automation under human approval.",
        options: { breakLine: true },
      },
      {
        text: "Show how on-device intelligence, secure collaboration, and measurable workflows reduce cycle time.",
        options: { breakLine: true },
      },
      {
        text: "Keep every claim reviewable: sources, owners, and explicit next actions.",
      },
    ],
    {
      x: 0.5,
      y: 1.2,
      w: 9,
      h: 3.5,
      fontSize: 18,
      color: mist,
      paraSpaceAfter: 12,
    },
  );

  const stack = pptx.addSlide();
  stack.background = { color: "0B1220" };
  stack.addText("Capability stack", {
    x: 0.5,
    y: 0.35,
    w: 9,
    h: 0.45,
    fontSize: 26,
    color: "FFFFFF",
    bold: true,
  });
  const pillars = [
    {
      title: "Perception",
      body: "Voice commands, private memory, and thread-aware context that stay on-device unless you approve otherwise.",
    },
    {
      title: "Reasoning",
      body: `Subject models for ${spec.subject} that turn goals into staged plans, briefs, and drafts.`,
    },
    {
      title: "Action",
      body: "Permissioned tools: research, documents, meeting agendas, and composer drafts with explicit approval.",
    },
    {
      title: "Assurance",
      body: "Audit metadata, bounded proposals, and human confirmation before anything leaves the device.",
    },
  ];
  pillars.forEach((pillar, index) => {
    const x = 0.45 + (index % 2) * 4.7;
    const y = 1.05 + Math.floor(index / 2) * 1.9;
    stack.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w: 4.4,
      h: 1.65,
      fill: { color: slate },
      shadow: { type: "outer", color: "000000", blur: 8, opacity: 0.25 },
    });
    stack.addText(pillar.title, {
      x: x + 0.25,
      y: y + 0.2,
      w: 3.9,
      h: 0.35,
      fontSize: 16,
      color: gold,
      bold: true,
    });
    stack.addText(pillar.body, {
      x: x + 0.25,
      y: y + 0.6,
      w: 3.9,
      h: 0.85,
      fontSize: 13,
      color: mist,
    });
  });

  const architecture = pptx.addSlide();
  architecture.background = { color: "0B1220" };
  architecture.addText("Architecture & operating workflow", {
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 0.5,
    fontSize: 26,
    color: "FFFFFF",
    bold: true,
  });
  architecture.addText(
    [
      {
        text: "1. Capture intent by voice or text (“Sophia…” compound commands).",
        options: { breakLine: true },
      },
      {
        text: "2. Local planner stages allowlisted actions without waiting on cloud inference.",
        options: { breakLine: true },
      },
      {
        text: "3. You approve each action: PPTX download, research, memory, or draft.",
        options: { breakLine: true },
      },
      {
        text: "4. Encrypted messaging remains the transport for human collaboration.",
        options: { breakLine: true },
      },
      {
        text: "5. Feedback and personal notes stay browser-local unless you export them.",
      },
    ],
    {
      x: 0.5,
      y: 1.15,
      w: 9,
      h: 3.6,
      fontSize: 17,
      color: mist,
      paraSpaceAfter: 10,
    },
  );

  const outcomes = pptx.addSlide();
  outcomes.background = { color: "0B1220" };
  outcomes.addText("Proof points & expected outcomes", {
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 0.5,
    fontSize: 26,
    color: "FFFFFF",
    bold: true,
  });
  outcomes.addTable(
    [
      [
        { text: "Outcome", options: { bold: true, color: "FFFFFF" } },
        { text: "Signal", options: { bold: true, color: "FFFFFF" } },
        { text: "Owner", options: { bold: true, color: "FFFFFF" } },
      ],
      [
        { text: "Faster briefing prep" },
        { text: "Time from ask → first deck" },
        { text: "You + Sophia" },
      ],
      [
        { text: "Better decisions" },
        { text: "Sources linked / claims reviewed" },
        { text: "Manager + team" },
      ],
      [
        { text: "Safer automation" },
        { text: "% actions requiring approval" },
        { text: "Security / product" },
      ],
      [
        { text: "Reusable memory" },
        { text: "Approved personal notes reused" },
        { text: "You (device-local)" },
      ],
    ],
    {
      x: 0.5,
      y: 1.15,
      w: 9,
      h: 3.2,
      colW: [3.2, 3.4, 2.4],
      border: { pt: 0.5, color: "334155" },
      fontFace: "Calibri",
      fontSize: 14,
      color: mist,
      fill: { color: slate },
      align: "left",
      valign: "middle",
    },
  );

  const risks = pptx.addSlide();
  risks.background = { color: "0B1220" };
  risks.addText("Risks, controls, open questions", {
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 0.5,
    fontSize: 26,
    color: "FFFFFF",
    bold: true,
  });
  risks.addText(
    [
      {
        text: "Risk: over-trusting generated slides → Control: treat Sophia decks as drafts; verify facts.",
        options: { breakLine: true },
      },
      {
        text: "Risk: leaking private context into research → Control: research uses only the standalone query.",
        options: { breakLine: true },
      },
      {
        text: "Risk: accidental sends → Control: draft insertion never sends; confirm exact message.",
        options: { breakLine: true },
      },
      {
        text: "Open: what decision do you need from this meeting, and by when?",
        options: { breakLine: true },
      },
      {
        text: "Open: which metrics prove this advanced-tech bet is working?",
      },
    ],
    {
      x: 0.5,
      y: 1.15,
      w: 9,
      h: 3.6,
      fontSize: 16,
      color: mist,
      paraSpaceAfter: 10,
    },
  );

  const ask = pptx.addSlide();
  ask.background = { color: ink };
  ask.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.18,
    h: 5.4,
    fill: { color: gold },
  });
  ask.addText("The ask", {
    x: 0.6,
    y: 1.2,
    w: 8.5,
    h: 0.5,
    fontSize: 28,
    color: "FFFFFF",
    bold: true,
  });
  ask.addText(
    [
      {
        text: `Approve the direction for ${spec.subject}.`,
        options: { breakLine: true },
      },
      {
        text: "Confirm owners, timeline, and the evidence standard we will use.",
        options: { breakLine: true },
      },
      {
        text: "Authorize the next research and meeting cycle with the team.",
      },
    ],
    {
      x: 0.6,
      y: 2,
      w: 8.5,
      h: 2,
      fontSize: 18,
      color: mist,
      paraSpaceAfter: 10,
    },
  );

  const output = await pptx.write({ outputType: "base64" });
  if (typeof output !== "string" || !output || output.length > maxPptxBase64Length) {
    throw new Error("The PowerPoint file could not be generated safely.");
  }
  return output;
}

export function buildResearchBriefDocument(input: {
  title: string;
  subjects: string[];
  query: string;
}): SophiaDocument {
  const title = sanitizeDocumentTitle(input.title);
  const subjects = input.subjects.length
    ? input.subjects
    : ["Competitor A", "Competitor B", "Competitor C"];
  const sections = subjects.map(
    (subject, index) =>
      `## ${index + 1}. ${subject}\n- Positioning\n- Strengths\n- Gaps\n- Sources to verify\n`,
  );
  const body = [
    `# ${title}`,
    "",
    `Search query staged for approval: ${input.query}`,
    "Treat public search snippets as untrusted. Confirm claims against the linked pages.",
    "",
    ...sections,
    "## Comparison",
    "| Competitor | Differentiator | Risk | Follow-up |",
    "| --- | --- | --- | --- |",
    ...subjects.map((subject) => `| ${subject} |  |  |  |`),
    "",
  ].join("\n");
  return {
    kind: "brief",
    title,
    filename: sanitizeDocumentFilename(title, "md"),
    mimeType: "text/markdown",
    body: body.slice(0, maxBodyLength),
  };
}

export function buildMeetingAgendaDocument(input: {
  title: string;
  when?: string;
  attendees?: string;
  purpose?: string;
}): SophiaDocument {
  const title = sanitizeDocumentTitle(input.title);
  const body = [
    `# ${title}`,
    "",
    `- When: ${input.when?.trim() || "to be confirmed"}`,
    `- Attendees: ${input.attendees?.trim() || "the team"}`,
    `- Purpose: ${input.purpose?.trim() || "align on next steps"}`,
    "",
    "## Agenda",
    "1. Goal and desired outcome",
    "2. Updates",
    "3. Decisions",
    "4. Owners and dates",
    "",
    "## Notes",
    "",
    "## Action items",
    "- [ ] ",
    "",
  ].join("\n");
  return {
    kind: "agenda",
    title,
    filename: sanitizeDocumentFilename(title, "md"),
    mimeType: "text/markdown",
    body: body.slice(0, maxBodyLength),
  };
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(document: {
  filename: string;
  body: string;
  mimeType?: string;
}) {
  if (typeof document.body !== "string" || !document.body.trim()) {
    throw new Error("The document is empty.");
  }
  if (document.body.length > maxBodyLength) {
    throw new Error("The document is too large to download.");
  }
  const blob = new Blob([document.body], {
    type: `${document.mimeType ?? "text/markdown"};charset=utf-8`,
  });
  triggerDownload(
    sanitizeDocumentFilename(document.filename.replace(/\.(md|txt|pptx)$/i, ""), "md"),
    blob,
  );
}

export async function downloadSophiaDocument(document: {
  filename: string;
  title: string;
  body: string;
  mimeType: SophiaDocumentMime;
  presentation?: PresentationSpec;
}) {
  if (document.mimeType === pptxMimeType || document.presentation) {
    const spec =
      document.presentation ??
      ({
        title: document.title,
        audience: "your audience",
        due: "the requested date",
        subject: inferPresentationSubject({ title: document.title }),
        notes: document.body,
      } satisfies PresentationSpec);
    const base64 = await generatePresentationPptx(spec);
    const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    triggerDownload(
      sanitizeDocumentFilename(document.filename.replace(/\.pptx$/i, ""), "pptx"),
      new Blob([binary], { type: pptxMimeType }),
    );
    return;
  }
  downloadTextFile(document);
}

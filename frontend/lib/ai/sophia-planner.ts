import {
  buildMeetingAgendaDocument,
  buildPresentationDocument,
  buildResearchBriefDocument,
  type SophiaDocument,
} from "./sophia-documents";
import type { MemoryFact } from "./personal-memory";
import { answerRadarQuestion } from "./radar-briefing";
import type { RadarStoreState } from "./radar-store";

export type SophiaIntent =
  | {
      type: "create_document";
      document: SophiaDocument;
    }
  | {
      type: "research";
      query: string;
    }
  | {
      type: "draft_message";
      body: string;
    }
  | {
      type: "remember_fact";
      fact: string;
    }
  | {
      type: "forget_fact";
      query: string;
    }
  | {
      type: "radar_answer";
      text: string;
    };

export type SophiaPlan = {
  addressedToSophia: boolean;
  intents: SophiaIntent[];
  spokenReply: string;
};

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const commandCue =
  /\b(prepare|create|draft|write|make|research|look up|search|organize|schedule|set up|remember|forget|remind|outstanding|promise[d]?|briefing|what's left|what is left)\b/i;

export function stripSophiaWakeWord(input: string) {
  return input
    .replace(
      /\b(?:hey |ok |okay |hi )?(?:sophia|jarvis)\b|,?\s*(?:sophia|jarvis)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function isSophiaAddressed(input: string) {
  return /\b(?:hey |ok |okay |hi )?(?:sophia|jarvis)\b/i.test(input);
}

function nextWeekday(now: Date, weekday: (typeof weekdays)[number]) {
  const target = weekdays.indexOf(weekday);
  const current = now.getDay();
  const daysAhead = (target - current + 7) % 7 || 7;
  const date = new Date(now);
  date.setDate(now.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

export function resolveRelativeDate(text: string, now: Date) {
  const match = text.match(
    /\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (!match?.[1]) {
    return undefined;
  }
  const weekday = match[1].toLowerCase() as (typeof weekdays)[number];
  return nextWeekday(now, weekday);
}

function extractQuotedNames(text: string) {
  return [...text.matchAll(/"([^"]{1,80})"/g)].map((match) => match[1].trim());
}

function extractCompetitorNames(text: string) {
  const listed = text.match(
    /competitors?\s+(?:named\s+)?([A-Za-z0-9&.,\s-]{3,120})/i,
  );
  if (!listed?.[1] || /three|several|some|our/i.test(listed[1])) {
    return extractQuotedNames(text);
  }
  return listed[1]
    .split(/\s*(?:,|and|&)\s*/)
    .map((name) => name.replace(/\.$/, "").trim())
    .filter((name) => name.length > 1 && !/^(the|team|market)$/i.test(name));
}

function memoryHint(memories: MemoryFact[], pattern: RegExp) {
  return memories.find((fact) => pattern.test(fact.text))?.text;
}

export function parseSophiaCommand(
  input: string,
  options: {
    memories?: MemoryFact[];
    recipientUsername?: string | null;
    now?: Date;
    radarStore?: RadarStoreState | null;
    conversationId?: string | null;
  } = {},
): SophiaPlan {
  const raw = input.replace(/\u0000/g, "").trim();
  const addressedToSophia = isSophiaAddressed(raw);
  const text = stripSophiaWakeWord(raw);
  if (!text || text.length > 2_000) {
    return { addressedToSophia, intents: [], spokenReply: "" };
  }
  if (!addressedToSophia && !commandCue.test(text)) {
    return { addressedToSophia, intents: [], spokenReply: "" };
  }

  const now = options.now ?? new Date();
  const memories = options.memories ?? [];
  const intents: SophiaIntent[] = [];
  const summaries: string[] = [];
  const due = resolveRelativeDate(text, now);
  const recipient = options.recipientUsername
    ? `@${options.recipientUsername}`
    : "the selected chat";
  const wantsPresentation =
    /\b(presentation|slides|slide deck|deck|pptx)\b/i.test(text);
  const wantsResearch =
    /\b(research|look up|search)\b/i.test(text) ||
    /\bcompetitors?\b/i.test(text);
  const wantsMeeting =
    /\borganize a meeting\b/i.test(text) ||
    (/\b(meeting|huddle|sync|standup)\b/i.test(text) &&
      /\b(organize|schedule|set up|arrange|book)\b/i.test(text));
  const rememberMatch = text.match(/\bremember(?: that)?\s+(.{3,240})$/i);
  const forgetMatch = text.match(/\bforget(?: that)?\s+(.{3,240})$/i);
  const explicitMemoryOnly =
    Boolean(rememberMatch || forgetMatch) &&
    !wantsPresentation &&
    !wantsResearch &&
    !wantsMeeting;

  if (options.radarStore && !explicitMemoryOnly && !wantsPresentation && !wantsResearch && !wantsMeeting) {
    const radarAnswer = answerRadarQuestion(text, options.radarStore, {
      now,
      conversationId: options.conversationId,
      peerUsername: options.recipientUsername,
    });
    if (radarAnswer) {
      return {
        addressedToSophia,
        intents: [{ type: "radar_answer", text: radarAnswer }],
        spokenReply: radarAnswer,
      };
    }
  }

  if (explicitMemoryOnly && rememberMatch?.[1]) {
    intents.push({ type: "remember_fact", fact: rememberMatch[1].trim() });
    summaries.push("store a personal note");
  } else if (explicitMemoryOnly && forgetMatch?.[1]) {
    intents.push({ type: "forget_fact", query: forgetMatch[1].trim() });
    summaries.push("remove a personal note");
  }

  if (!explicitMemoryOnly && wantsPresentation) {
    const audienceMatch = text.match(
      /\b(?:presentation|slides|slide deck|deck|pptx)\b(?:[^.]{0,80}?)\b(?:for|to)\s+(?:my\s+)?([A-Za-z][A-Za-z-]{1,40})\b/i,
    );
    const audience = audienceMatch?.[1]?.trim();
    const title = audience
      ? `Presentation for ${audience}`
      : "Presentation outline";
    const document = buildPresentationDocument({
      title,
      audience,
      due,
      notes: text,
    });
    intents.push({ type: "create_document", document });
    intents.push({
      type: "remember_fact",
      fact: due ? `${title} is due ${due}` : `${title} is in progress`,
    });
    summaries.push(`prepare ${document.filename}`);
  }

  if (!explicitMemoryOnly && wantsResearch) {
    const named = extractCompetitorNames(text);
    const countMatch = text.match(/\b(\d+|three|two|four)\s+competitors?\b/i);
    const count =
      countMatch?.[1] === "two"
        ? 2
        : countMatch?.[1] === "three"
          ? 3
          : countMatch?.[1] === "four"
            ? 4
            : Number(countMatch?.[1] || named.length || 3);
    const subjects =
      named.length > 0
        ? named.slice(0, Math.min(4, count))
        : Array.from(
            { length: Math.min(4, Math.max(1, count)) },
            (_, index) => `Competitor ${index + 1}`,
          );
    const industry =
      memoryHint(memories, /\b(industry|company|product|market)\b/i) ??
      "the relevant market";
    const query = named.length
      ? `${named.join(" vs ")} competitors overview`
      : `${subjects.length} competitors ${industry}`.slice(0, 300);
    intents.push({ type: "research", query: query.slice(0, 300) });
    intents.push({
      type: "create_document",
      document: buildResearchBriefDocument({
        title: "Competitor research brief",
        subjects,
        query,
      }),
    });
    summaries.push("stage competitor research and a brief");
  }

  if (!explicitMemoryOnly && wantsMeeting) {
    const when = due ?? "a time the team can do";
    const purpose = wantsPresentation
      ? "prepare the manager presentation"
      : "align on next steps";
    const agenda = buildMeetingAgendaDocument({
      title: "Team meeting agenda",
      when,
      attendees: "the team",
      purpose,
    });
    const draft = [
      `Hi — can we meet to ${purpose}?`,
      `Proposed timing: ${when}.`,
      "I'll share an agenda and we can confirm owners in the room.",
    ].join(" ");
    intents.push({ type: "create_document", document: agenda });
    intents.push({ type: "draft_message", body: draft.slice(0, 4_000) });
    summaries.push(`draft a meeting note for ${recipient}`);
  }

  if (
    !intents.length &&
    /\b(create|write|draft|make)\b.+\b(doc|document|note|brief|agenda)\b/i.test(
      text,
    )
  ) {
    const document = buildPresentationDocument({
      title: text.slice(0, 80),
      notes: text,
      due,
    });
    document.kind = "notes";
    intents.push({ type: "create_document", document });
    summaries.push(`create ${document.filename}`);
  }

  const unique: SophiaIntent[] = [];
  const seen = new Set<string>();
  for (const intent of intents.slice(0, 8)) {
    const key = JSON.stringify(intent);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(intent);
  }

  if (!unique.length) {
    return {
      addressedToSophia,
      intents: [],
      spokenReply: addressedToSophia
        ? "I'm here. Ask what's outstanding, what you promised someone, request a briefing, or give me a presentation, research, meeting, or note task."
        : "",
    };
  }

  const actionable = unique.filter((intent) => intent.type !== "radar_answer");
  if (!actionable.length) {
    const answer = unique.find((intent) => intent.type === "radar_answer");
    return {
      addressedToSophia,
      intents: unique,
      spokenReply:
        answer && answer.type === "radar_answer"
          ? answer.text
          : "I checked authorized Radar context on this device.",
    };
  }

  return {
    addressedToSophia,
    intents: unique,
    spokenReply: `On it. I staged ${summaries.join(", ")}. None of this runs until you approve each action.`,
  };
}

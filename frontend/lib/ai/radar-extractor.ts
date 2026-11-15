import type { LocalMessage } from "../crypto/types";
import { resolveRelativeDate } from "./jarvis-planner";
import type {
  RadarCommittedBy,
  RadarFinding,
  RadarFindingCategory,
} from "./radar-store";

export type RadarExtractionInput = {
  conversationId: string;
  messages: Array<
    Pick<
      LocalMessage,
      "id" | "conversationId" | "plaintext" | "fromMe" | "createdAt"
    >
  >;
  now?: Date;
  createId?: () => string;
};

const maxMessageCharacters = 2_000;
const maxScanMessages = 80;

function normalizePlaintext(text: string) {
  return text.replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
}

function isoDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function resolveAbsoluteDate(text: string, now: Date) {
  const relative = resolveRelativeDate(text, now);
  if (relative) {
    return relative;
  }
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1]) {
    return iso[1];
  }
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const year = slash[3] ? Number(slash[3]) : now.getFullYear();
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      ) {
        return isoDateOnly(date);
      }
    }
  }
  if (/\btoday\b/i.test(text)) {
    return isoDateOnly(now);
  }
  if (/\btomorrow\b/i.test(text)) {
    const date = new Date(now);
    date.setDate(now.getDate() + 1);
    return isoDateOnly(date);
  }
  if (/\bnext week\b/i.test(text)) {
    const date = new Date(now);
    date.setDate(now.getDate() + 7);
    return isoDateOnly(date);
  }
  return undefined;
}

function titleFromMessage(text: string, category: RadarFindingCategory) {
  const clipped = text.slice(0, 140);
  switch (category) {
    case "deadline":
      return clipped.replace(/^(please\s+|kindly\s+)/i, "") || "Deadline mentioned";
    case "commitment":
      return clipped.replace(/^(i(?:'ll| will| can)\s+)/i, "Follow up: ") ||
        "Personal commitment";
    case "decision":
      return clipped || "Decision noted";
    case "question":
      return clipped || "Unresolved question";
  }
}

function classifyMessage(
  message: Pick<LocalMessage, "plaintext" | "fromMe">,
  now: Date,
): {
  category: RadarFindingCategory;
  dueAt?: string;
  committedBy: RadarCommittedBy;
  title: string;
} | null {
  const text = normalizePlaintext(message.plaintext);
  if (text.length < 8 || text.length > maxMessageCharacters) {
    return null;
  }
  if (/^PM1(?:IMG|ALB|AUD|VID|FIL|LOC):/i.test(text)) {
    return null;
  }

  const dueAt = resolveAbsoluteDate(text, now);
  const deadlineCue =
    Boolean(dueAt) ||
    /\b(?:deadline|due(?:\s+by|\s+on)?|by\s+(?:eod|eow|friday|monday|tuesday|wednesday|thursday|saturday|sunday)|asap|end of (?:day|week))\b/i.test(
      text,
    ) ||
    /\b(?:before|by)\s+(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week)\b/i.test(
      text,
    );

  const commitmentCue =
    /\b(?:i(?:'ll| will| can)|let me|i(?:'m| am) (?:going to|gonna)|i promise|i'll make sure|send(?:ing)? (?:it|this|the)|deliver(?:ing)?)\b/i.test(
      text,
    ) ||
    /\b(?:رح|رحّ|حابب أرسل|بقدر أرسل|بوعدك)\b/u.test(text);

  const requestCue =
    /\b(?:please|can you|could you|would you|need you to|make sure to|don't forget to)\b/i.test(
      text,
    ) || /\b(?:لو سمحت|ممكن|بدي منك)\b/u.test(text);

  const decisionCue =
    /\b(?:we(?:'ll| will)|let's|lets|decided|agreed|going with|ship|approve(?:d)?)\b/i.test(
      text,
    );

  const questionCue =
    /[?؟]/u.test(text) ||
    /\b(?:what|when|where|who|why|how|did you|have you|any update)\b/i.test(text);

  if (message.fromMe && commitmentCue && !requestCue) {
    return {
      category: "commitment",
      dueAt,
      committedBy: "self",
      title: titleFromMessage(text, "commitment"),
    };
  }

  if (deadlineCue && (requestCue || commitmentCue || Boolean(dueAt))) {
    return {
      category: "deadline",
      dueAt,
      committedBy: message.fromMe
        ? "self"
        : requestCue
          ? "unknown"
          : "peer",
      title: titleFromMessage(text, "deadline"),
    };
  }

  if (!message.fromMe && requestCue && (commitmentCue || deadlineCue || dueAt)) {
    return {
      category: "deadline",
      dueAt,
      committedBy: "unknown",
      title: titleFromMessage(text, "deadline"),
    };
  }

  if (decisionCue && (dueAt || /\b(?:friday|monday|next week|tomorrow|today)\b/i.test(text))) {
    return {
      category: "decision",
      dueAt,
      committedBy: message.fromMe ? "self" : "peer",
      title: titleFromMessage(text, "decision"),
    };
  }

  if (!message.fromMe && questionCue && text.length <= 280) {
    return {
      category: "question",
      dueAt,
      committedBy: "peer",
      title: titleFromMessage(text, "question"),
    };
  }

  return null;
}

export function findingIdForMessage(
  conversationId: string,
  messageId: string,
  category: RadarFindingCategory,
) {
  return `radar:${conversationId}:${messageId}:${category}`;
}

export function extractRadarFindings({
  conversationId,
  messages,
  now = new Date(),
  createId,
}: RadarExtractionInput): RadarFinding[] {
  const scoped = messages
    .filter((message) => message.conversationId === conversationId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-maxScanMessages);

  const findings: RadarFinding[] = [];
  const seen = new Set<string>();
  for (const message of scoped) {
    const classified = classifyMessage(message, now);
    if (!classified) {
      continue;
    }
    const id =
      createId?.() ??
      findingIdForMessage(conversationId, message.id, classified.category);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const timestamp = message.createdAt || now.toISOString();
    findings.push({
      id,
      conversationId,
      messageIds: [message.id],
      category: classified.category,
      title: classified.title.slice(0, 160),
      excerpt: normalizePlaintext(message.plaintext).slice(0, 280),
      dueAt: classified.dueAt,
      committedBy: classified.committedBy,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return findings;
}

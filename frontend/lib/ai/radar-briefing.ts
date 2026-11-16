import type { RadarFinding, RadarStoreState, RadarTaskDraft } from "./radar-store";
import { listPendingFindings } from "./radar-store";

export type RadarBriefingOptions = {
  now?: Date;
  conversationId?: string | null;
  peerUsername?: string | null;
  maxItems?: number;
};

export type RadarBriefing = {
  generatedAt: string;
  headline: string;
  lines: string[];
  pendingCount: number;
  openTaskCount: number;
  dueSoonCount: number;
};

function dayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDue(value?: string) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value.length <= 10 ? `${value}T12:00:00.000Z` : value);
  return Number.isFinite(parsed) ? parsed : null;
}

function openTasks(state: RadarStoreState, conversationId?: string | null) {
  return state.taskDrafts.filter((draft) => {
    if (draft.status !== "open") {
      return false;
    }
    if (conversationId && draft.conversationId && draft.conversationId !== conversationId) {
      return false;
    }
    return true;
  });
}

function selfCommitments(findings: RadarFinding[]) {
  return findings.filter(
    (finding) =>
      finding.committedBy === "self" &&
      (finding.status === "pending" ||
        finding.status === "snoozed" ||
        finding.status === "accepted"),
  );
}

function dueSoonTasks(tasks: RadarTaskDraft[], now: Date, withinDays = 3) {
  const end = now.getTime() + withinDays * 24 * 60 * 60 * 1000;
  return tasks.filter((task) => {
    const due = parseDue(task.dueAt);
    return due !== null && due <= end;
  });
}

export function buildDailyBriefing(
  state: RadarStoreState,
  options: RadarBriefingOptions = {},
): RadarBriefing {
  const now = options.now ?? new Date();
  const maxItems = options.maxItems ?? 6;
  const pending = listPendingFindings(state, options.conversationId, now);
  const tasks = openTasks(state, options.conversationId);
  const soon = dueSoonTasks(tasks, now);
  const lines: string[] = [];

  if (pending.length) {
    lines.push(
      `${pending.length} pending Radar finding${pending.length === 1 ? "" : "s"} need review.`,
    );
    for (const finding of pending.slice(0, 3)) {
      lines.push(
        `• ${finding.title}${finding.dueAt ? ` (due ${finding.dueAt.slice(0, 10)})` : ""}`,
      );
    }
  }

  if (soon.length) {
    lines.push(
      `${soon.length} accepted task${soon.length === 1 ? "" : "s"} due within 3 days.`,
    );
    for (const task of soon.slice(0, 3)) {
      lines.push(`• ${task.title}${task.dueAt ? ` · ${task.dueAt.slice(0, 10)}` : ""}`);
    }
  }

  const otherOpen = tasks.filter((task) => !soon.some((item) => item.id === task.id));
  if (otherOpen.length) {
    lines.push(
      `${otherOpen.length} other open task draft${otherOpen.length === 1 ? "" : "s"} on this device.`,
    );
  }

  if (!lines.length) {
    lines.push("Nothing outstanding in authorized Radar context on this device.");
  }

  return {
    generatedAt: now.toISOString(),
    headline: `Daily briefing · ${dayKey(now)}`,
    lines: lines.slice(0, maxItems + 3),
    pendingCount: pending.length,
    openTaskCount: tasks.length,
    dueSoonCount: soon.length,
  };
}

function extractPromiseSubject(query: string) {
  const match = query.match(
    /\b(?:promise[d]?|told|committed(?:\s+to)?|said(?:\s+to)?)\s+(?:to\s+)?@?([A-Za-z0-9_.-]{2,40})\b/i,
  );
  if (match?.[1]) {
    return match[1].replace(/^@/, "");
  }
  const about = query.match(/\b(?:about|regarding|with)\s+@?([A-Za-z0-9_.-]{2,40})\b/i);
  return about?.[1]?.replace(/^@/, "") ?? null;
}

function matchesSubject(
  text: string,
  subject: string,
  peerUsername?: string | null,
) {
  const needle = subject.toLowerCase();
  if (text.toLowerCase().includes(needle)) {
    return true;
  }
  if (peerUsername && peerUsername.toLowerCase() === needle) {
    return true;
  }
  return false;
}

export function answerRadarQuestion(
  query: string,
  state: RadarStoreState,
  options: RadarBriefingOptions = {},
): string | null {
  const text = query.replace(/\u0000/g, "").trim();
  if (!text || text.length > 500) {
    return null;
  }

  const now = options.now ?? new Date();
  const outstanding =
    /\b(outstanding|open|pending|due|deadline|what(?:'s| is) left|to[- ]?do|commitments?|tasks?)\b/i.test(
      text,
    );
  const promise =
    /\b(promise[d]?|commit(?:ted|ment)?|told|said i(?:'d| would)|what did i)\b/i.test(
      text,
    );
  const briefing =
    /\b(brief(?:ing)?|summary for today|today(?:'s)? radar|catch me up)\b/i.test(
      text,
    );

  if (!outstanding && !promise && !briefing) {
    return null;
  }

  if (briefing || (outstanding && !promise)) {
    const briefingText = buildDailyBriefing(state, options);
    return [briefingText.headline, ...briefingText.lines].join("\n");
  }

  const subject = extractPromiseSubject(text);
  const pending = listPendingFindings(state, options.conversationId, now);
  const acceptedSelf = selfCommitments([
    ...pending,
    ...state.findings.filter((finding) => finding.status === "accepted"),
  ]);
  const tasks = openTasks(state, options.conversationId);
  const scopedFindings = subject
    ? acceptedSelf.filter((finding) =>
        matchesSubject(
          `${finding.title} ${finding.excerpt}`,
          subject,
          options.peerUsername,
        ),
      )
    : acceptedSelf.filter((finding) => finding.committedBy === "self");
  const scopedTasks = subject
    ? tasks.filter((task) =>
        matchesSubject(task.title, subject, options.peerUsername),
      )
    : tasks;

  if (!scopedFindings.length && !scopedTasks.length) {
    return subject
      ? `I don't have an authorized local commitment matching “${subject}” yet.`
      : "I don't see self-attributed commitments in authorized Radar context on this device.";
  }

  const lines = [
    subject
      ? `Here's what I have related to ${subject} from authorized local Radar context:`
      : "Here's what you appear to have committed to in authorized local Radar context:",
  ];
  for (const finding of scopedFindings.slice(0, 4)) {
    lines.push(
      `• ${finding.title}${finding.dueAt ? ` (due ${finding.dueAt.slice(0, 10)})` : ""} [${finding.status}]`,
    );
  }
  for (const task of scopedTasks.slice(0, 4)) {
    if (scopedFindings.some((finding) => finding.taskDraftId === task.id)) {
      continue;
    }
    lines.push(
      `• Task draft: ${task.title}${task.dueAt ? ` · ${task.dueAt.slice(0, 10)}` : ""}`,
    );
  }
  return lines.join("\n");
}

export type RadarClientCounters = {
  findingsProposed: number;
  findingsAccepted: number;
  findingsDismissed: number;
  briefingsGenerated: number;
  questionsAnswered: number;
};

export const emptyRadarClientCounters = (): RadarClientCounters => ({
  findingsProposed: 0,
  findingsAccepted: 0,
  findingsDismissed: 0,
  briefingsGenerated: 0,
  questionsAnswered: 0,
});

const counterPrefix = "private-messenger:radar-counters:";

export function radarCountersStorageKey(userId: string) {
  return `${counterPrefix}${userId}`;
}

export function parseRadarClientCounters(value: unknown): RadarClientCounters {
  if (typeof value !== "object" || value === null) {
    return emptyRadarClientCounters();
  }
  const candidate = value as Record<string, unknown>;
  const read = (key: keyof RadarClientCounters) => {
    const raw = candidate[key];
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
      ? Math.min(1_000_000, Math.floor(raw))
      : 0;
  };
  return {
    findingsProposed: read("findingsProposed"),
    findingsAccepted: read("findingsAccepted"),
    findingsDismissed: read("findingsDismissed"),
    briefingsGenerated: read("briefingsGenerated"),
    questionsAnswered: read("questionsAnswered"),
  };
}

export function loadRadarClientCounters(userId: string): RadarClientCounters {
  if (!userId || typeof window === "undefined") {
    return emptyRadarClientCounters();
  }
  try {
    const stored = window.localStorage.getItem(radarCountersStorageKey(userId));
    return stored
      ? parseRadarClientCounters(JSON.parse(stored))
      : emptyRadarClientCounters();
  } catch {
    return emptyRadarClientCounters();
  }
}

export function saveRadarClientCounters(
  userId: string,
  counters: RadarClientCounters,
) {
  if (!userId || typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(
      radarCountersStorageKey(userId),
      JSON.stringify(parseRadarClientCounters(counters)),
    );
    return true;
  } catch {
    return false;
  }
}

export function bumpRadarCounter(
  counters: RadarClientCounters,
  key: keyof RadarClientCounters,
  by = 1,
): RadarClientCounters {
  return {
    ...counters,
    [key]: Math.min(1_000_000, counters[key] + Math.max(0, Math.floor(by))),
  };
}

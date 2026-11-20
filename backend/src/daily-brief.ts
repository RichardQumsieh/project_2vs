import { validateProposalPayload } from "./integrations/mail-calendar-approval.js";

/**
 * Manager daily brief.
 *
 * Facts come only from mail and calendar mirrors the person connected.
 * E2EE chat fields are dropped even if a caller passes them in.
 * Suggested actions are proposals for the existing approval path.
 * This module never calls a mail or calendar provider.
 */

export type BriefLanguage = "en" | "ar";
export type BriefSourceKind = "morning" | "on_demand";
export type BriefMode = "mock" | "live";

export type BriefPreference = {
  briefTime: string;
  language: BriefLanguage;
  timeZone: string;
};

export type BriefCalendarEvent = {
  id: string;
  externalEventId: string;
  provider: "google" | "outlook";
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  busy: boolean;
};

export type BriefMailMessage = {
  id: string;
  provider: "gmail" | "outlook-mail";
  fromAddress: string;
  subject: string;
  snippet: string;
  receivedAt: string;
};

export type BriefConnections = {
  mail: boolean;
  calendar: boolean;
};

export type BriefSource = {
  calendar: BriefCalendarEvent[];
  mail: BriefMailMessage[];
  /**
   * Set when the caller checked live connections.
   * Both false means mail and calendar are disconnected.
   * Omitted means the caller already supplied the facts to brief.
   */
  connections?: BriefConnections;
};

export type BriefMeeting = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  prepNote: string;
  conflictsWith: string[];
};

export type BriefReply = {
  id: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  urgency: "high" | "medium" | "low";
  reason: string;
};

export type BriefFollowUp = {
  id: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  daysOverdue: number;
};

export type BriefApproval =
  | {
      action: "save_draft";
      provider: "gmail" | "outlook-mail";
      idempotencyKey: string;
      payload: { to: string[]; subject: string; body: string };
    }
  | {
      action: "reschedule_event";
      provider: "google" | "outlook";
      idempotencyKey: string;
      payload: {
        externalEventId: string;
        title: string;
        startsAt: string;
        endsAt: string;
        allDay: false;
      };
    }
  | {
      action: "delete_event";
      provider: "google" | "outlook";
      idempotencyKey: string;
      payload: { eventId: string };
    };

export type BriefSuggestedAction = {
  id: string;
  kind: "draft_reply" | "reschedule" | "decline";
  title: string;
  detail: string;
  approvalRequired: true;
  approval: BriefApproval;
};

export type DailyBriefDocument = {
  localDate: string;
  timeZone: string;
  language: BriefLanguage;
  generatedAt: string;
  source: BriefSourceKind;
  mode: BriefMode;
  narrative: string;
  meetings: BriefMeeting[];
  needsReply: BriefReply[];
  overdueFollowUps: BriefFollowUp[];
  actions: BriefSuggestedAction[];
};

export type BriefAssistant = {
  mode: BriefMode;
  complete?: (input: { prompt: string; contextLines: string[] }) => Promise<string | null>;
};

const privateKeys = new Set([
  "plaintext",
  "ciphertext",
  "messages",
  "transcript",
  "messageBody",
  "privateMessages",
  "conversationMessages",
]);

const briefTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const emailPattern =
  /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/;
const requestPattern =
  /\?|\b(please|can you|can we|could you|need|follow[- ]?up|reply|urgent|asap|deadline|today)\b|عاجل|رد|متابعة|لو سمحت|بدي|ضروري|اليوم/i;
const urgentPattern = /\b(urgent|asap|eod|deadline)\b|عاجل|ضروري/i;
const newsletterPattern = /noreply|no-reply|newsletter|notifications@|unsubscribe/i;
const stopwords = new Set([
  "this", "that", "with", "from", "your", "today", "about", "need", "please",
  "meeting", "call", "mail", "email", "reply", "follow",
]);

export function defaultBriefPreference(): BriefPreference {
  return { briefTime: "07:00", language: "en", timeZone: "Asia/Amman" };
}

export function parseBriefPreference(body: unknown):
  | { ok: true; preference: BriefPreference }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid daily brief settings." };
  }
  const row = body as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.some((key) => privateKeys.has(key))) {
    return { ok: false, error: "Daily brief settings cannot include chat." };
  }
  if (typeof row.briefTime !== "string" || !briefTimePattern.test(row.briefTime)) {
    return { ok: false, error: "Brief time must be HH:mm in 24-hour form." };
  }
  if (row.language !== "en" && row.language !== "ar") {
    return { ok: false, error: "Brief language must be en or ar." };
  }
  if (typeof row.timeZone !== "string" || !isTimeZone(row.timeZone)) {
    return { ok: false, error: "Brief time zone is not recognized." };
  }
  return {
    ok: true,
    preference: {
      briefTime: row.briefTime,
      language: row.language,
      timeZone: row.timeZone,
    },
  };
}

export function isTimeZone(value: string) {
  if (!value || value.length > 80 || value === "local") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(instant: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function offsetAt(utcMs: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag = Object.fromEntries(
    fmt.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(bag.year),
    Number(bag.month) - 1,
    Number(bag.day),
    Number(bag.hour) % 24,
    Number(bag.minute),
    Number(bag.second),
  );
  return asUtc - utcMs;
}

export function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) throw new Error("Invalid zoned time.");
  const utcGuess = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(clock[1]),
    Number(clock[2]),
    0,
  );
  const offset = offsetAt(utcGuess, timeZone);
  const corrected = utcGuess - offset;
  const offsetAgain = offsetAt(corrected, timeZone);
  return new Date(corrected - (offsetAgain - offset));
}

export function localDayBounds(date: string, timeZone: string) {
  const start = zonedDateTimeToUtc(date, "00:00", timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + 1));
  const nextDate = next.toISOString().slice(0, 10);
  const end = zonedDateTimeToUtc(nextDate, "00:00", timeZone);
  return { start, end };
}

export function briefIsDue(input: {
  now: Date;
  timeZone: string;
  briefTime: string;
  generatedForDate: string | null;
}) {
  const local = zonedParts(input.now, input.timeZone);
  if (input.generatedForDate === local.date) return false;
  const [hour, minute] = input.briefTime.split(":").map(Number);
  return local.hour * 60 + local.minute >= (hour ?? 0) * 60 + (minute ?? 0);
}

function clip(value: string, max: number) {
  const cleaned = value.replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readEvent(value: unknown): BriefCalendarEvent | null {
  const row = asRecord(value);
  if (!row) return null;
  if (row.provider !== "google" && row.provider !== "outlook") return null;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  if (typeof row.startsAt !== "string" || typeof row.endsAt !== "string") return null;
  if (!Number.isFinite(Date.parse(row.startsAt)) || !Number.isFinite(Date.parse(row.endsAt))) {
    return null;
  }
  const externalEventId = typeof row.externalEventId === "string" ? row.externalEventId : "";
  return {
    id: row.id,
    externalEventId: clip(externalEventId, 200),
    provider: row.provider,
    title: clip(row.title, 200),
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    allDay: row.allDay === true,
    busy: row.busy !== false,
  };
}

function readMail(value: unknown): BriefMailMessage | null {
  const row = asRecord(value);
  if (!row) return null;
  if (row.provider !== "gmail" && row.provider !== "outlook-mail") return null;
  if (typeof row.id !== "string" || typeof row.subject !== "string") return null;
  if (typeof row.fromAddress !== "string" || typeof row.receivedAt !== "string") return null;
  if (!Number.isFinite(Date.parse(row.receivedAt))) return null;
  return {
    id: row.id,
    provider: row.provider,
    fromAddress: clip(row.fromAddress, 320),
    subject: clip(row.subject, 200),
    snippet: typeof row.snippet === "string" ? clip(row.snippet, 180) : "",
    receivedAt: new Date(row.receivedAt).toISOString(),
  };
}

function readConnections(value: unknown): BriefConnections | undefined {
  const row = asRecord(value);
  if (!row || typeof row.mail !== "boolean" || typeof row.calendar !== "boolean") return undefined;
  return { mail: row.mail, calendar: row.calendar };
}

/** True only when the caller checked and neither mail nor calendar is connected. */
export function briefConnectionsMissing(source: BriefSource): boolean {
  return source.connections?.mail === false && source.connections?.calendar === false;
}

/** Copies calendar and mail fields only. Chat keys are ignored. */
export function readIntegrationSnapshot(input: unknown): BriefSource {
  const row = asRecord(input) ?? {};
  const calendar = Array.isArray(row.calendar) ? row.calendar.flatMap((item) => {
    const event = readEvent(item);
    return event ? [event] : [];
  }) : [];
  const mail = Array.isArray(row.mail) ? row.mail.flatMap((item) => {
    const message = readMail(item);
    return message ? [message] : [];
  }) : [];
  const connections = readConnections(row.connections);
  return {
    calendar: calendar.slice(0, 40),
    mail: mail.slice(0, 40),
    ...(connections ? { connections } : {}),
  };
}

function extractEmail(value: string) {
  return emailPattern.exec(value)?.[0] ?? null;
}

function personLabel(address: string) {
  const email = extractEmail(address) ?? address;
  const local = email.split("@")[0] ?? email;
  const word = local.split(/[._-]/)[0] ?? local;
  if (!word) return email;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function tokens(value: string) {
  return value
    .toLocaleLowerCase("en")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !stopwords.has(word));
}

function sharesToken(left: string, right: string) {
  const wanted = new Set(tokens(left));
  return tokens(right).some((word) => wanted.has(word));
}

function isNewsletter(message: BriefMailMessage) {
  return newsletterPattern.test(`${message.fromAddress} ${message.subject}`);
}

function urgencyScore(message: BriefMailMessage, now: Date) {
  const text = `${message.subject} ${message.snippet}`;
  let score = 0;
  if (urgentPattern.test(text)) score += 5;
  if (/\btoday\b|اليوم/i.test(text)) score += 3;
  if (text.includes("?")) score += 2;
  if (requestPattern.test(text)) score += 2;
  const age = now.getTime() - Date.parse(message.receivedAt);
  if (age >= 0 && age < 12 * 60 * 60 * 1000) score += 3;
  else if (age >= 0 && age < 36 * 60 * 60 * 1000) score += 1;
  return score;
}

function urgencyLabel(score: number): BriefReply["urgency"] {
  if (score >= 8) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function reasonFor(message: BriefMailMessage, urgency: BriefReply["urgency"], language: BriefLanguage) {
  if (language === "ar") {
    if (urgency === "high") return "مستعجلة وبدها رد.";
    return "بدها رد.";
  }
  if (urgency === "high") return "Urgent and needs a reply.";
  return "Needs a reply.";
}

function overlaps(left: BriefCalendarEvent, right: BriefCalendarEvent) {
  if (!left.busy || !right.busy || left.id === right.id) return false;
  return Date.parse(left.startsAt) < Date.parse(right.endsAt)
    && Date.parse(right.startsAt) < Date.parse(left.endsAt);
}

function actionKey(localDate: string, kind: "draft" | "move" | "decline", sourceId: string) {
  const slug = sourceId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
  if (slug.length < 4) return null;
  return `brief${localDate.replace(/-/g, "")}${kind}${slug}`.slice(0, 80);
}

function draftBody(message: BriefMailMessage, language: BriefLanguage) {
  const subject = clip(message.subject, 120);
  if (language === "ar") {
    return `شفت رسالتك بخصوص «${subject}». برد عليك اليوم. هاي مسودة وما انرسلت.`;
  }
  return `I saw your note about “${subject}”. I will follow up today. This is a draft and was not sent.`;
}

function replySubject(subject: string) {
  const trimmed = clip(subject, 180);
  if (/^re:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`.slice(0, 200);
}

function buildActions(input: {
  localDate: string;
  language: BriefLanguage;
  meetings: BriefMeeting[];
  events: BriefCalendarEvent[];
  needsReply: BriefReply[];
  overdue: BriefFollowUp[];
  mail: BriefMailMessage[];
}): BriefSuggestedAction[] {
  const actions: BriefSuggestedAction[] = [];
  const replyTarget = input.needsReply[0] ?? input.overdue[0];
  if (replyTarget) {
    const message = input.mail.find((item) => item.id === replyTarget.id);
    const email = message ? extractEmail(message.fromAddress) : null;
    const key = message ? actionKey(input.localDate, "draft", message.id) : null;
    if (message && email && key) {
      const approval: BriefApproval = {
        action: "save_draft",
        provider: message.provider,
        idempotencyKey: key,
        payload: {
          to: [email],
          subject: replySubject(message.subject),
          body: draftBody(message, input.language),
        },
      };
      if (validateProposalPayload(approval.action, approval.provider, approval.payload).ok) {
        actions.push({
          id: key,
          kind: "draft_reply",
          title: input.language === "ar"
            ? `مسودة رد لـ ${personLabel(message.fromAddress)}`
            : `Draft a reply to ${personLabel(message.fromAddress)}`,
          detail: input.language === "ar"
            ? "الموافقة تحفظ مسودة فقط. ما بينبعت الإيميل."
            : "Approval saves a draft only. The email is not sent.",
          approvalRequired: true,
          approval,
        });
      }
    }
  }

  const timed = input.events.filter((event) => event.busy && !event.allDay);
  const pair = timed
    .flatMap((event) => timed
      .filter((other) => other.id > event.id && overlaps(event, other))
      .map((other) => (Date.parse(event.startsAt) <= Date.parse(other.startsAt)
        ? { blocker: event, target: other }
        : { blocker: other, target: event })))
    .sort((left, right) => Date.parse(left.blocker.startsAt) - Date.parse(right.blocker.startsAt))[0];

  if (pair) {
    const duration = Date.parse(pair.target.endsAt) - Date.parse(pair.target.startsAt);
    const startMs = Date.parse(pair.blocker.endsAt);
    const moveKey = actionKey(input.localDate, "move", pair.target.id);
    if (moveKey && duration >= 15 * 60_000 && duration <= 8 * 60 * 60_000 && Number.isFinite(startMs)) {
      const approval: BriefApproval = {
        action: "reschedule_event",
        provider: pair.target.provider,
        idempotencyKey: moveKey,
        payload: {
          externalEventId: pair.target.externalEventId,
          title: pair.target.title,
          startsAt: new Date(startMs).toISOString(),
          endsAt: new Date(startMs + duration).toISOString(),
          allDay: false,
        },
      };
      if (
        pair.target.externalEventId
        && validateProposalPayload(approval.action, approval.provider, approval.payload).ok
      ) {
        actions.push({
          id: moveKey,
          kind: "reschedule",
          title: input.language === "ar"
            ? `اقتراح تأجيل ${pair.target.title}`
            : `Propose moving ${pair.target.title}`,
          detail: input.language === "ar"
            ? `بعد ${pair.blocker.title}. ما بيتغير التقويم قبل الموافقة.`
            : `After ${pair.blocker.title}. The calendar does not change until you approve.`,
          approvalRequired: true,
          approval,
        });
      }
    }

    const declineKey = actionKey(input.localDate, "decline", pair.target.id);
    if (declineKey) {
      const approval: BriefApproval = {
        action: "delete_event",
        provider: pair.target.provider,
        idempotencyKey: declineKey,
        payload: { eventId: pair.target.id },
      };
      if (validateProposalPayload(approval.action, approval.provider, approval.payload).ok) {
        actions.push({
          id: declineKey,
          kind: "decline",
          title: input.language === "ar"
            ? `رفض ${pair.target.title}`
            : `Decline ${pair.target.title}`,
          detail: input.language === "ar"
            ? "الموافقة تحذف الحدث من التقويم. ما بينحذف شي قبل ما توافق."
            : "Approval removes this event from the calendar. Nothing is removed until you approve.",
          approvalRequired: true,
          approval,
        });
      }
    }
  }

  return actions.slice(0, 3);
}

function renderNarrative(input: {
  language: BriefLanguage;
  meetings: BriefMeeting[];
  needsReply: BriefReply[];
  overdueFollowUps: BriefFollowUp[];
}) {
  const conflict = input.meetings.find((meeting) => meeting.conflictsWith.length > 0);
  const reply = input.needsReply[0];
  const meetingCount = input.meetings.length;
  const overdueCount = input.overdueFollowUps.length;
  if (input.language === "ar") {
    const parts = [
      meetingCount === 0
        ? "ما في اجتماعات اليوم."
        : meetingCount === 1
          ? "اليوم عندك اجتماع واحد."
          : meetingCount === 2
            ? "اليوم عندك اجتماعين."
            : `اليوم عندك ${meetingCount} اجتماعات.`,
    ];
    if (conflict) parts.push(`${conflict.title} بيتعارض مع ${conflict.conflictsWith[0]}.`);
    if (reply) parts.push(`الأولوية للرد على ${personLabel(reply.fromAddress)}.`);
    if (overdueCount === 1) parts.push("في متابعة متأخرة.");
    else if (overdueCount > 1) parts.push(`${overdueCount} متابعات متأخرة.`);
    parts.push("الاقتراحات بتستنى موافقتك. ما انبعت إشي ولا تغيّر.");
    return parts.join(" ");
  }
  const parts = [
    meetingCount === 0
      ? "No meetings today."
      : `Today you have ${meetingCount} ${meetingCount === 1 ? "meeting" : "meetings"}.`,
  ];
  if (conflict) parts.push(`${conflict.title} conflicts with ${conflict.conflictsWith[0]}.`);
  if (reply) parts.push(`Reply first to ${personLabel(reply.fromAddress)}.`);
  if (overdueCount === 1) parts.push("1 follow-up is overdue.");
  else if (overdueCount > 1) parts.push(`${overdueCount} follow-ups are overdue.`);
  parts.push("Suggestions wait for your approval. Nothing was sent or changed.");
  return parts.join(" ");
}

export function briefModelPrompt(language: BriefLanguage) {
  if (language === "ar") {
    return "اكتب موجز صباح قصير من السياق المتصل فقط. لا تذكر رسائل الدردشة. لا تقول إنك أرسلت أو حجزت أو حذفت شيئًا. الاقتراحات تنتظر الموافقة.";
  }
  return "Write a short morning brief from the connected context only. Do not mention private chat. Do not claim you sent, booked, or deleted anything. Suggestions wait for approval.";
}

export function briefContextLines(document: Pick<
  DailyBriefDocument,
  "meetings" | "needsReply" | "overdueFollowUps" | "actions"
>) {
  const lines: string[] = [];
  for (const meeting of document.meetings) {
    const conflict = meeting.conflictsWith.length
      ? ` conflicts ${meeting.conflictsWith.join(", ")}`
      : "";
    lines.push(`Meeting: ${meeting.title} from ${meeting.startsAt} to ${meeting.endsAt}.${conflict}`);
  }
  for (const message of document.needsReply) {
    lines.push(`Reply: ${message.subject} from ${message.fromAddress} urgency ${message.urgency}`);
  }
  for (const message of document.overdueFollowUps) {
    lines.push(`Overdue: ${message.subject} from ${message.fromAddress} days ${message.daysOverdue}`);
  }
  for (const action of document.actions) {
    lines.push(`Suggestion: ${action.kind} ${action.title}`);
  }
  return lines.slice(0, 24);
}

export async function narrateDailyBrief(
  facts: Omit<DailyBriefDocument, "narrative" | "mode">,
  assistant: BriefAssistant,
): Promise<{ narrative: string; mode: BriefMode }> {
  const fallback = renderNarrative(facts);
  if (assistant.mode !== "live" || !assistant.complete) {
    return { narrative: fallback, mode: "mock" };
  }
  try {
    const text = await assistant.complete({
      prompt: briefModelPrompt(facts.language),
      contextLines: briefContextLines(facts),
    });
    const narrative = text ? clip(text, 1_200) : "";
    if (!narrative) return { narrative: fallback, mode: "mock" };
    return { narrative, mode: "live" };
  } catch {
    return { narrative: fallback, mode: "mock" };
  }
}

export async function composeDailyBrief(input: {
  now: Date;
  preference: BriefPreference;
  source: unknown;
  sourceKind: BriefSourceKind;
  assistant: BriefAssistant;
}): Promise<DailyBriefDocument> {
  const snapshot = readIntegrationSnapshot(input.source);
  const local = zonedParts(input.now, input.preference.timeZone);
  const bounds = localDayBounds(local.date, input.preference.timeZone);
  const events = snapshot.calendar
    .filter((event) => {
      const starts = Date.parse(event.startsAt);
      const ends = Date.parse(event.endsAt);
      return starts < bounds.end.getTime() && ends > bounds.start.getTime();
    })
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
    .slice(0, 12);

  const recentMail = snapshot.mail
    .filter((message) => {
      const age = input.now.getTime() - Date.parse(message.receivedAt);
      return age >= 0 && age <= 14 * 24 * 60 * 60 * 1000;
    })
    .filter((message) => !isNewsletter(message));

  const ranked = recentMail
    .map((message) => ({ message, score: urgencyScore(message, input.now) }))
    .filter((item) => item.score >= 2 && requestPattern.test(`${item.message.subject} ${item.message.snippet}`))
    .sort((left, right) => right.score - left.score || Date.parse(right.message.receivedAt) - Date.parse(left.message.receivedAt));

  const overdueCutoff = 48 * 60 * 60 * 1000;
  const needsReply: BriefReply[] = [];
  const overdue: BriefFollowUp[] = [];
  for (const item of ranked) {
    const age = input.now.getTime() - Date.parse(item.message.receivedAt);
    if (age > overdueCutoff) {
      overdue.push({
        id: item.message.id,
        fromAddress: item.message.fromAddress,
        subject: item.message.subject,
        receivedAt: item.message.receivedAt,
        daysOverdue: Math.max(2, Math.floor(age / (24 * 60 * 60 * 1000))),
      });
    } else {
      const urgency = urgencyLabel(item.score);
      needsReply.push({
        id: item.message.id,
        fromAddress: item.message.fromAddress,
        subject: item.message.subject,
        receivedAt: item.message.receivedAt,
        urgency,
        reason: reasonFor(item.message, urgency, input.preference.language),
      });
    }
  }

  const meetings: BriefMeeting[] = events.map((event) => {
    const conflictsWith = events
      .filter((other) => overlaps(event, other))
      .map((other) => other.title);
    const related = recentMail.find((message) =>
      sharesToken(event.title, message.subject) || sharesToken(event.title, message.snippet));
    const prepNote = input.preference.language === "ar"
      ? related
        ? `راجع رسالة ${personLabel(related.fromAddress)} عن «${related.subject}».`
        : "راجع جدول الاجتماع قبل ما يبدأ."
      : related
        ? `Prep: read ${personLabel(related.fromAddress)} on “${related.subject}”.`
        : "Prep: review the agenda before it starts.";
    return {
      id: event.id,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      prepNote,
      conflictsWith,
    };
  });

  const facts = {
    localDate: local.date,
    timeZone: input.preference.timeZone,
    language: input.preference.language,
    generatedAt: input.now.toISOString(),
    source: input.sourceKind,
    meetings,
    needsReply: needsReply.slice(0, 5),
    overdueFollowUps: overdue.slice(0, 5),
    actions: buildActions({
      localDate: local.date,
      language: input.preference.language,
      meetings,
      events,
      needsReply: needsReply.slice(0, 5),
      overdue: overdue.slice(0, 5),
      mail: recentMail,
    }),
  };
  const narrated = await narrateDailyBrief(facts, input.assistant);
  return { ...facts, narrative: narrated.narrative, mode: narrated.mode };
}

/** Counts only. Safe to pass to the process logger. */
export function briefLogFields(document: DailyBriefDocument) {
  return {
    dailyBrief: true as const,
    mode: document.mode,
    source: document.source,
    meetings: document.meetings.length,
    needsReply: document.needsReply.length,
    overdue: document.overdueFollowUps.length,
    actions: document.actions.length,
  };
}

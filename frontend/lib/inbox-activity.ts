import type { AgentToolAction } from "@/lib/ai/agent-runtime";
import {
  validateOutboundAttachments,
  type OutboundEmailAttachment,
} from "./email-attachments";
import {
  emailTypoWarnings,
  isEmailAddress,
  prepareOutboundEmail,
} from "./email-compose";

export type InboxActivityView = "agenda" | "email" | "event";

export type MirroredMail = {
  id: string;
  receivedAt: string;
};

export type MirroredEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
};

export function sortRecentMail<T extends MirroredMail>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const delta = Date.parse(right.receivedAt) - Date.parse(left.receivedAt);
    if (delta !== 0 && Number.isFinite(delta)) {
      return delta;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export function upcomingEvents<T extends MirroredEvent>(
  items: readonly T[],
  now: number,
): T[] {
  return items
    .filter((item) => {
      const end = Date.parse(item.endsAt);
      const start = Date.parse(item.startsAt);
      const boundary = Number.isFinite(end) ? end : start;
      return Number.isFinite(boundary) && boundary >= now;
    })
    .sort((left, right) => {
      const delta = Date.parse(left.startsAt) - Date.parse(right.startsAt);
      if (delta !== 0 && Number.isFinite(delta)) {
        return delta;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
}

export function parseAddressField(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localDayRange(
  startDate: string,
  endDate: string,
): { startsAt: string; endsAt: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return null;
  }
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return null;
  }
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

export function buildEmailDraftAction(input: {
  provider: "gmail" | "outlook-mail";
  to: string;
  cc?: string;
  subject: string;
  body: string;
  delivery?: "send" | "draft";
  attachments?: readonly OutboundEmailAttachment[];
}):
  | {
      ok: true;
      action: Extract<AgentToolAction, { type: "draft_email" }>;
      warnings: string[];
    }
  | { ok: false; error: string } {
  const to = parseAddressField(input.to);
  if (to.length === 0 || to.length > 20 || !to.every((item) => isEmailAddress(item))) {
    return { ok: false, error: "Enter at least one valid recipient." };
  }
  const cc = input.cc?.trim() ? parseAddressField(input.cc) : [];
  if (cc.length > 20 || cc.some((item) => !isEmailAddress(item))) {
    return { ok: false, error: "Cc addresses must be valid emails." };
  }
  const subject = input.subject.trim();
  const source = input.body.trim();
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) {
    return { ok: false, error: "Subject must be 1–200 characters." };
  }
  if (!source || source.length > 20_000) {
    return { ok: false, error: "Body must be 1–20,000 characters." };
  }
  const outbound = prepareOutboundEmail(source);
  if (!outbound.text) {
    return { ok: false, error: "Body must be 1–20,000 characters." };
  }
  const files = validateOutboundAttachments(input.attachments);
  if (!files.ok) {
    return files;
  }
  return {
    ok: true,
    warnings: emailTypoWarnings([...to, ...cc]),
    action: {
      type: "draft_email",
      provider: input.provider,
      to,
      subject,
      body: outbound.text,
      ...(input.delivery ? { delivery: input.delivery } : {}),
      ...(outbound.html
        ? { html: outbound.html, contentType: outbound.contentType }
        : { contentType: "text/plain" as const }),
      ...(cc.length > 0 ? { cc } : {}),
      ...(files.attachments.length > 0 ? { attachments: files.attachments } : {}),
    },
  };
}

export function emailApiPayload(
  action: Extract<AgentToolAction, { type: "draft_email" }>,
) {
  return {
    to: action.to,
    subject: action.subject,
    body: action.body,
    ...(action.cc ? { cc: action.cc } : {}),
    ...(action.html
      ? {
          html: action.html,
          contentType: action.contentType ?? ("text/html" as const),
        }
      : {}),
    ...(action.attachments?.length ? { attachments: action.attachments } : {}),
  };
}

export function buildCalendarEventAction(input: {
  provider: "google" | "outlook";
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  description?: string;
}):
  | { ok: true; action: Extract<AgentToolAction, { type: "create_calendar_event" }> }
  | { ok: false; error: string } {
  const title = input.title.trim();
  if (!title || title.length > 200) {
    return { ok: false, error: "Title must be 1–200 characters." };
  }
  const start = Date.parse(input.startsAt);
  const end = Date.parse(input.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { ok: false, error: "End time must be at or after the start." };
  }
  const description = input.description?.trim() ?? "";
  if (description.length > 4_000) {
    return { ok: false, error: "Description must be 4,000 characters or fewer." };
  }
  return {
    ok: true,
    action: {
      type: "create_calendar_event",
      provider: input.provider,
      title,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
      allDay: input.allDay,
      ...(description ? { description } : {}),
    },
  };
}

const mirrorIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mailProviderId(
  provider: string,
): "gmail" | "outlook-mail" | null {
  if (provider === "GMAIL" || provider === "gmail") {
    return "gmail";
  }
  if (provider === "OUTLOOK_MAIL" || provider === "outlook-mail") {
    return "outlook-mail";
  }
  return null;
}

export function calendarProviderId(
  provider: string,
): "google" | "outlook" | null {
  if (provider === "GOOGLE_CALENDAR" || provider === "google") {
    return "google";
  }
  if (provider === "OUTLOOK_CALENDAR" || provider === "outlook") {
    return "outlook";
  }
  return null;
}

export function extractReplyAddress(fromAddress: string) {
  const trimmed = fromAddress.trim();
  const angle = /<([^<>\s]+)>/.exec(trimmed);
  const candidate = (angle?.[1] ?? trimmed).trim();
  return isEmailAddress(candidate) ? candidate : null;
}

export function replySubject(subject: string) {
  const cleaned =
    subject.replace(/[\r\n\u0000]/g, " ").replace(/\s+/g, " ").trim() ||
    "(no subject)";
  const next = /^re:/i.test(cleaned) ? cleaned : `Re: ${cleaned}`;
  return next.slice(0, 200);
}

export type MailReplySeed = {
  messageId: string;
  provider: "gmail" | "outlook-mail";
  to: string;
  subject: string;
  body: string;
};

export function buildMailReplySeed(input: {
  messageId: string;
  provider: "gmail" | "outlook-mail";
  fromAddress: string;
  subject: string;
  whenLabel: string;
  body: string;
}): { ok: true; seed: MailReplySeed } | { ok: false; error: string } {
  const to = extractReplyAddress(input.fromAddress);
  if (!to) {
    return { ok: false, error: "This message has no reply address." };
  }
  const source = input.body.replace(/\r\n/g, "\n").trim().slice(0, 8_000);
  const quoted = (source || "(no message text)")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const when =
    input.whenLabel.replace(/[\r\n\u0000]/g, " ").trim() || "an earlier time";
  const from = input.fromAddress.replace(/[\r\n\u0000]/g, " ").trim() || to;
  return {
    ok: true,
    seed: {
      messageId: input.messageId,
      provider: input.provider,
      to,
      subject: replySubject(input.subject),
      body: `\n\nOn ${when}, ${from} wrote:\n${quoted}`,
    },
  };
}

export function buildDeleteCalendarAction(input: {
  provider: "google" | "outlook";
  eventId: string;
  title: string;
}):
  | { ok: true; action: Extract<AgentToolAction, { type: "delete_calendar_event" }> }
  | { ok: false; error: string } {
  const title = input.title.replace(/\u0000/g, "").trim();
  if (!title || title.length > 200) {
    return { ok: false, error: "This event needs a title before it can be removed." };
  }
  if (!mirrorIdPattern.test(input.eventId)) {
    return { ok: false, error: "This event cannot be removed from here." };
  }
  return {
    ok: true,
    action: {
      type: "delete_calendar_event",
      provider: input.provider,
      eventId: input.eventId,
      title,
    },
  };
}

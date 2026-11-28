import {
  isSystemPlaintext,
  isWaitingPlaintext,
  parseChatPayload,
  systemMessageText,
} from "./chat-payload";
import type { LocalMessage } from "./crypto/types";

export const memberPalette = [
  "#7C5CBF",
  "#0F7A5A",
  "#B45309",
  "#9F1239",
  "#1D4E89",
  "#0F766E",
  "#9A3412",
  "#6D28D9",
] as const;

export type GroupMemberRef = {
  userId: string;
  username?: string;
  displayName?: string | null;
  role?: "ADMIN" | "MEMBER";
  readCursor?: { blobId: string; createdAt: string } | null;
};

export function memberColor(userId: string) {
  let hash = 0;
  for (const char of userId) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return memberPalette[hash % memberPalette.length] ?? memberPalette[0];
}

export function memberLabel(member: { displayName?: string | null; username?: string } | undefined, fallback = "Member") {
  const name = member?.displayName?.trim() || member?.username?.trim();
  return name || fallback;
}

export function memberInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts.length > 1 ? parts.slice(0, 2) : [parts[0] ?? ""]).map((part) => part[0] ?? "");
  const text = letters.join("").toUpperCase();
  return text.slice(0, 2) || "?";
}

export function messageCoversRead(
  message: { id: string; createdAt: string },
  cursor: { blobId: string; createdAt: string },
) {
  if (message.createdAt < cursor.createdAt) return true;
  if (message.createdAt > cursor.createdAt) return false;
  return message.id <= cursor.blobId;
}

/** Other members whose read cursor is at or past this message. Empty when the API has no cursors. */
export function readersOfMessage(
  message: { id: string; createdAt: string; senderUserId?: string },
  members: readonly GroupMemberRef[],
  selfUserId: string | null,
) {
  if (!members.some((member) => "readCursor" in member)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const member of members) {
    if (!member.readCursor || member.userId === selfUserId || member.userId === message.senderUserId) continue;
    if (seen.has(member.userId) || !messageCoversRead(message, member.readCursor)) continue;
    seen.add(member.userId);
    names.push(memberLabel(member));
  }
  return names;
}

export function readByLabel(names: readonly string[]) {
  if (names.length === 0) return null;
  if (names.length === 1) return `Read by ${names[0]}`;
  if (names.length === 2) return `Read by ${names[0]} and ${names[1]}`;
  return `Read by ${names[0]} and ${names.length - 1} others`;
}

export type MentionMember = { username: string; displayName?: string | null };

export function mentionQuery(draft: string, caret: number) {
  const slice = draft.slice(0, Math.max(0, caret));
  const match = /(?:^|\s)@([A-Za-z0-9_]{0,32})$/.exec(slice);
  if (!match) return null;
  return { query: match[1] ?? "", start: slice.length - (match[1]?.length ?? 0) - 1 };
}

export function mentionSuggestions(members: readonly MentionMember[], query: string, selfUsername?: string) {
  const needle = query.toLowerCase();
  return members
    .filter((member) => member.username && member.username.toLowerCase() !== selfUsername?.toLowerCase())
    .filter((member) => {
      if (!needle) return true;
      return member.username.toLowerCase().startsWith(needle)
        || (member.displayName ?? "").toLowerCase().includes(needle);
    })
    .slice(0, 6);
}

export function applyMention(draft: string, start: number, caret: number, username: string) {
  const next = `${draft.slice(0, start)}@${username} ${draft.slice(caret)}`;
  const nextCaret = start + username.length + 2;
  return { text: next, caret: nextCaret };
}

export function mentionParts(text: string, usernames: readonly string[]) {
  if (usernames.length === 0 || !text.includes("@")) return [{ kind: "text" as const, value: text }];
  const escaped = [...usernames].sort((left, right) => right.length - left.length).map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const pattern = new RegExp(`@(?:${escaped.join("|")})(?![A-Za-z0-9_])`, "gi");
  const parts: Array<{ kind: "text" | "mention"; value: string }> = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: "text", value: text.slice(cursor, index) });
    parts.push({ kind: "mention", value: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: "text", value: text.slice(cursor) });
  return parts.length > 0 ? parts : [{ kind: "text" as const, value: text }];
}

export type GroupRow =
  | { kind: "date"; id: string; label: string }
  | { kind: "system"; id: string; text: string }
  | { kind: "message"; id: string; message: LocalMessage; cluster: "single" | "first" | "middle" | "last"; showSender: boolean };

const CLUSTER_MS = 5 * 60 * 1000;

function dayStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function formatGroupDay(iso: string, now: Date, locale = "en") {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  const arabic = locale.toLowerCase().startsWith("ar");
  if (diff === 0) return arabic ? "اليوم" : "Today";
  if (diff === 1) return arabic ? "أمس" : "Yesterday";
  return new Intl.DateTimeFormat(arabic ? "ar" : "en", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function sameRun(previous: LocalMessage | undefined, message: LocalMessage) {
  if (!previous) return false;
  if (isSystemPlaintext(previous.plaintext) || isSystemPlaintext(message.plaintext)) return false;
  if (isWaitingPlaintext(previous.plaintext) || isWaitingPlaintext(message.plaintext)) return false;
  if (Boolean(previous.fromMe) !== Boolean(message.fromMe)) return false;
  if ((previous.senderUserId ?? "") !== (message.senderUserId ?? "")) return false;
  const delta = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return delta >= 0 && delta <= CLUSTER_MS;
}

export function buildGroupRows(
  messages: readonly LocalMessage[],
  now = new Date(),
  locale = "en",
  created?: { at: string; title?: string | null; actor?: string } | null,
): GroupRow[] {
  const sorted = [...messages].sort((left, right) =>
    left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt),
  );
  const hasCreated = sorted.some((message) => {
    const payload = parseChatPayload(message.plaintext);
    return payload.type === "system" && payload.event === "created";
  });
  const rows: GroupRow[] = [];
  if (created && !hasCreated) {
    rows.push({
      kind: "system",
      id: "group-created",
      text: systemMessageText({
        event: "created",
        actor: created.actor || "Someone",
        title: created.title?.trim() || undefined,
      }),
    });
  }
  let lastDay = "";
  sorted.forEach((message, index) => {
    const payload = parseChatPayload(message.plaintext);
    const day = formatGroupDay(message.createdAt, now, locale);
    const dayKey = String(dayStart(new Date(message.createdAt)));
    if (day && dayKey !== lastDay) {
      rows.push({ kind: "date", id: `date-${dayKey}`, label: day });
      lastDay = dayKey;
    }
    if (payload.type === "system") {
      rows.push({ kind: "system", id: message.id, text: systemMessageText(payload) });
      return;
    }
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const previousDay = previous ? formatGroupDay(previous.createdAt, now, locale) : "";
    const nextDay = next ? formatGroupDay(next.createdAt, now, locale) : "";
    const previousGrouped = sameRun(previous, message) && previousDay === day;
    const nextGrouped = next ? sameRun(message, next) && nextDay === day : false;
    const cluster = previousGrouped ? (nextGrouped ? "middle" : "last") : (nextGrouped ? "first" : "single");
    rows.push({
      kind: "message",
      id: message.id,
      message,
      cluster,
      showSender: !message.fromMe && (cluster === "single" || cluster === "first"),
    });
  });
  return rows;
}

export function mediaMessages(messages: readonly LocalMessage[]) {
  return messages.filter((message) => {
    const payload = parseChatPayload(message.plaintext);
    return payload.type === "image" || payload.type === "album" || payload.type === "video" || payload.type === "voice" || payload.type === "file";
  });
}

export function typingLabel(names: readonly string[]) {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return `${names[0]} and ${names.length - 1} others are typing`;
}

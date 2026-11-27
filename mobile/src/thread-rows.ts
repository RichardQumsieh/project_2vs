import type { LocalMessage } from "../../frontend/lib/crypto/types";

export type MessageCluster = "single" | "first" | "middle" | "last";

export type ThreadRow =
  | { kind: "date"; id: string; label: string }
  | { kind: "message"; id: string; message: LocalMessage; cluster: MessageCluster; showSender: boolean };

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function dayStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function formatThreadDay(iso: string, now: Date, locale = "en") {
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

function sameGroup(previous: LocalMessage | undefined, message: LocalMessage) {
  if (!previous) return false;
  if (Boolean(previous.fromMe) !== Boolean(message.fromMe)) return false;
  if ((previous.senderUserId ?? "") !== (message.senderUserId ?? "")) return false;
  const delta = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return delta >= 0 && delta <= GROUP_WINDOW_MS;
}

export function buildThreadRows(messages: readonly LocalMessage[], now = new Date(), locale = "en"): ThreadRow[] {
  const sorted = [...messages].sort((left, right) =>
    left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt),
  );
  const rows: ThreadRow[] = [];
  let lastDay = "";
  sorted.forEach((message, index) => {
    const day = formatThreadDay(message.createdAt, now, locale);
    const dayKey = dayStart(new Date(message.createdAt));
    if (String(dayKey) !== lastDay) {
      rows.push({ kind: "date", id: `date-${dayKey}`, label: day });
      lastDay = String(dayKey);
    }
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const previousGrouped = sameGroup(previous, message) && formatThreadDay(previous!.createdAt, now, locale) === day;
    const nextGrouped = next ? sameGroup(message, next) && formatThreadDay(next.createdAt, now, locale) === day : false;
    const cluster: MessageCluster = previousGrouped
      ? nextGrouped ? "middle" : "last"
      : nextGrouped ? "first" : "single";
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

export function clusterSpacing(cluster: MessageCluster) {
  return cluster === "middle" || cluster === "first" ? 2 : 10;
}

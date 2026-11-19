"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bold, CalendarDays, Italic, Link2, List, Mail, Paperclip, X } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { SophiaMark } from "@/components/sophia-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SophiaApproveSuccess,
  SophiaProposalCard,
} from "@/components/sophia-proposal-card";
import { api } from "@/lib/api";
import {
  agentActionSummary,
  createAgentRuntime,
  type AgentProposal,
  type AgentRuntime,
  type AgentToolAction,
} from "@/lib/ai/agent-runtime";
import { loadJobDefaults } from "@/lib/ai/sophia-job-defaults";
import { localizedRuntimeMessage } from "@/lib/i18n/action-summary";
import {
  formatAttachmentSize,
  maxEmailAttachmentCount,
  maxEmailAttachmentTotalBytes,
  readEmailAttachmentFile,
  type OutboundEmailAttachment,
} from "@/lib/email-attachments";
import { wrapComposerSelection } from "@/lib/email-compose";
import {
  buildCalendarEventAction,
  buildDeleteCalendarAction,
  buildEmailDraftAction,
  buildMailReplySeed,
  calendarProviderId,
  emailApiPayload,
  localDayRange,
  mailProviderId,
  sortRecentMail,
  toDatetimeLocalValue,
  upcomingEvents,
  type InboxActivityView,
  type MailReplySeed,
} from "@/lib/inbox-activity";
import { currentUserId } from "@/lib/session";
import { useI18n } from "@/lib/i18n/locale";

type MailRow = {
  id: string;
  provider: string;
  accountEmail: string | null;
  subject: string;
  fromAddress: string;
  receivedAt: string;
  snippet: string;
};

type EventRow = {
  id: string;
  provider: string;
  accountEmail: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
};

type InboxActivityContextValue = {
  view: InboxActivityView;
  setView: (view: InboxActivityView) => void;
  mobileOpen: boolean;
  closeMobile: () => void;
  composeRequest: number;
};

const InboxActivityContext = createContext<InboxActivityContextValue | null>(null);

export function InboxActivityState({
  view,
  setView,
  mobileOpen,
  closeMobile,
  composeRequest,
  children,
}: InboxActivityContextValue & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ view, setView, mobileOpen, closeMobile, composeRequest }),
    [closeMobile, composeRequest, mobileOpen, setView, view],
  );
  return (
    <InboxActivityContext.Provider value={value}>
      {children}
    </InboxActivityContext.Provider>
  );
}

const rowHeight = 76;

function ActivityRows<T extends { id: string }>({
  items,
  renderItem,
}: {
  items: readonly T[];
  renderItem: (item: T) => React.ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 12 });
  const itemCount = items.length;

  const measure = useCallback(() => {
    const node = scrollerRef.current;
    if (!node || itemCount === 0) {
      return;
    }
    const start = Math.max(0, Math.floor(node.scrollTop / rowHeight) - 2);
    const end = Math.min(
      itemCount,
      start + Math.ceil(node.clientHeight / rowHeight) + 6,
    );
    setRange((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, [itemCount]);

  useEffect(() => {
    measure();
    const node = scrollerRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  if (itemCount === 0) {
    return null;
  }

  const slice = items.slice(range.start, range.end);

  return (
    <div
      ref={scrollerRef}
      onScroll={measure}
      className="h-full min-h-0 overflow-y-auto overscroll-contain"
      style={{ contain: "layout style paint" }}
    >
      <div className="relative" style={{ height: itemCount * rowHeight }}>
        <div
          className="absolute inset-x-0"
          style={{ top: range.start * rowHeight }}
        >
          {slice.map((item) => (
            <div key={item.id} style={{ height: rowHeight }}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatWhen(iso: string, allDay = false) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, allDay
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  ).format(date);
}

function defaultRange() {
  const start = new Date();
  start.setSeconds(0, 0);
  if (start.getMinutes() < 30) {
    start.setMinutes(30);
  } else {
    start.setHours(start.getHours() + 1, 0, 0, 0);
  }
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const startValue = toDatetimeLocalValue(start);
  const endValue = toDatetimeLocalValue(end);
  return {
    start: startValue,
    end: endValue,
    day: startValue.slice(0, 10),
    endDay: endValue.slice(0, 10),
  };
}

function useMirroredActivity() {
  const mail = useQuery({
    queryKey: ["inbox-mail"],
    queryFn: () => api.listEmailMessages(),
    staleTime: 20_000,
  });
  const events = useQuery({
    queryKey: ["inbox-events"],
    queryFn: () => api.listCalendarEvents(),
    staleTime: 20_000,
  });
  const recentMail = useMemo(
    () => sortRecentMail(mail.data?.messages ?? []),
    [mail.data?.messages],
  );
  const upcoming = useMemo(
    () => upcomingEvents(events.data?.events ?? [], events.dataUpdatedAt),
    [events.data?.events, events.dataUpdatedAt],
  );
  return { mail, events, recentMail, upcoming };
}

export function InboxComposeLetter({
  open,
  onClose,
  onStage,
  emailProvider: emailProviderDefault,
  initial = null,
}: {
  open: boolean;
  onClose: () => void;
  onStage: (action: AgentToolAction) => void;
  emailProvider: "gmail" | "outlook-mail";
  initial?: MailReplySeed | null;
}) {
  const { t } = useI18n();
  const [emailProvider, setEmailProvider] = useState(
    initial?.provider ?? emailProviderDefault,
  );
  const [to, setTo] = useState(initial?.to ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [attachments, setAttachments] = useState<OutboundEmailAttachment[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [addressWarnings, setAddressWarnings] = useState<string[]>([]);
  const [typoOverride, setTypoOverride] = useState(false);
  const emailBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (initial) {
      const element = emailBodyRef.current;
      element?.focus();
      element?.setSelectionRange(0, 0);
    } else {
      toRef.current?.focus();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const root = dialogRef.current;
      if (!root) {
        return;
      }
      const nodes = [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")]
        .filter((node) => !node.hasAttribute("disabled") && node.tabIndex !== -1);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [initial, open]);

  function applyFormat(kind: "bold" | "italic" | "link") {
    const element = emailBodyRef.current;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    const next = wrapComposerSelection(body, start, end, kind);
    setBody(next.value);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.start, next.end);
    });
  }

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) {
      return;
    }
    const next = [...attachments];
    const errors: string[] = [];
    for (const file of list) {
      if (next.length >= maxEmailAttachmentCount) {
        errors.push("You can attach up to 5 files.");
        break;
      }
      const total = next.reduce((sum, item) => sum + item.size, 0);
      if (total + file.size > maxEmailAttachmentTotalBytes) {
        errors.push("Attachments together must be 2 MB or smaller.");
        break;
      }
      const read = await readEmailAttachmentFile(file);
      if (!read.ok) {
        errors.push(`${file.name}: ${read.error}`);
        continue;
      }
      next.push(read.attachment);
    }
    setAttachments(next);
    setFormError(errors[0] ?? null);
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  }

  function stageEmail(delivery: "send" | "draft") {
    const built = buildEmailDraftAction({
      provider: emailProvider,
      to,
      cc,
      subject,
      body,
      delivery,
      attachments,
    });
    if (!built.ok) {
      setAddressWarnings([]);
      setTypoOverride(false);
      setFormError(built.error);
      return;
    }
    if (built.warnings.length > 0 && !typoOverride) {
      setAddressWarnings(built.warnings);
      setTypoOverride(true);
      setFormError(null);
      return;
    }
    try {
      onStage(built.action);
      setFormError(null);
      setAddressWarnings([]);
      setTypoOverride(false);
      setBody("");
      setAttachments([]);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not stage that email.");
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="inbox-letter-stage">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-letter-title"
        aria-describedby="inbox-letter-note"
        ref={dialogRef}
        className="inbox-letter"
        onSubmit={(event) => {
          event.preventDefault();
          stageEmail("send");
        }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-black/10 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/45">
              Sophia
            </p>
            <h2 id="inbox-letter-title" className="mt-1 text-xl font-semibold tracking-tight">
              {initial ? t("mail.reply") : t("mail.new")}
            </h2>
          </div>
          <button
            type="button"
            className="inbox-letter-icon"
            aria-label={t("mail.closeCompose")}
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <label className="block space-y-1 text-xs font-medium">
            {t("mail.mailbox")}
            <select
              className="inbox-letter-field"
              value={emailProvider}
              onChange={(event) =>
                setEmailProvider(event.target.value as "gmail" | "outlook-mail")
              }
            >
              <option value="gmail">Gmail</option>
              <option value="outlook-mail">Outlook</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs font-medium">
            {t("mail.to")}
            <input dir="ltr"
              ref={toRef}
              className="inbox-letter-field"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setTypoOverride(false);
                setAddressWarnings([]);
              }}
              placeholder={t("mail.toPlaceholder")}
              autoComplete="email"
              inputMode="email"
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Cc
            <input
              className="inbox-letter-field"
              value={cc}
              onChange={(event) => {
                setCc(event.target.value);
                setTypoOverride(false);
                setAddressWarnings([]);
              }}
              placeholder={t("mail.optional")}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Subject
            <input
              className="inbox-letter-field"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
            />
          </label>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Message</span>
              <div className="flex gap-1">
                <button type="button" className="inbox-letter-icon" aria-label="Bold" onClick={() => applyFormat("bold")}>
                  <Bold aria-hidden="true" className="size-3.5" />
                </button>
                <button type="button" className="inbox-letter-icon" aria-label="Italic" onClick={() => applyFormat("italic")}>
                  <Italic aria-hidden="true" className="size-3.5" />
                </button>
                <button type="button" className="inbox-letter-icon" aria-label="Insert link" onClick={() => applyFormat("link")}>
                  <Link2 aria-hidden="true" className="size-3.5" />
                </button>
              </div>
            </div>
            <textarea
              ref={emailBodyRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="inbox-letter-field inbox-letter-body"
              dir="auto"
              placeholder={t("mail.bodyPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Attachments</span>
              <button
                type="button"
                className="inbox-letter-quiet"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip aria-hidden="true" className="size-3.5" />
                Attach files
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
              onChange={(event) => void addFiles(event.target.files)}
            />
            {attachments.length > 0 ? (
              <ul className="space-y-1">
                {attachments.map((file, index) => (
                  <li
                    key={`${file.filename}-${file.size}-${index}`}
                    className="flex items-center gap-2 rounded-lg border border-black/10 px-2 py-1.5 text-xs"
                  >
                    <Paperclip aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {file.filename}
                      <span className="text-black/50"> · {formatAttachmentSize(file.size)}</span>
                    </span>
                    <button
                      type="button"
                      className="inbox-letter-icon"
                      aria-label={`Remove ${file.filename}`}
                      onClick={() =>
                        setAttachments((current) => current.filter((_, item) => item !== index))
                      }
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-black/50">
                Images, PDF, and Office documents. Up to 5 files, 2 MB together. No scripts.
              </p>
            )}
          </div>
        </div>
        <footer className="space-y-2 border-t border-black/10 px-5 py-4">
          <p id="inbox-letter-note" className="text-[11px] leading-relaxed text-black/55">
            {t("mail.approvalNote")}
          </p>
          {addressWarnings.length > 0 ? (
            <p role="status" className="text-xs text-amber-800">
              {addressWarnings.join(" ")} Review the address, then stage again to continue.
            </p>
          ) : null}
          {formError ? (
            <p role="alert" className="text-xs text-red-800">{formError}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="inbox-letter-primary">
              {typoOverride ? t("mail.stageSendAnyway") : t("mail.stageSend")}
            </button>
            <button
              type="button"
              className="inbox-letter-secondary"
              onClick={() => stageEmail("draft")}
            >
              {typoOverride ? t("mail.stageDraftAnyway") : t("mail.stageDraft")}
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

export function InboxActivityPanel({
  view,
  onViewChange,
  onClose,
  onStage,
  emailProvider: emailProviderDefault,
  calendarProvider: calendarProviderDefault,
  showBack = false,
  onBack,
}: {
  view: InboxActivityView;
  onViewChange: (view: InboxActivityView) => void;
  onClose?: () => void;
  onStage: (action: AgentToolAction) => void;
  emailProvider: "gmail" | "outlook-mail";
  calendarProvider: "google" | "outlook";
  showBack?: boolean;
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const { mail, events, recentMail, upcoming } = useMirroredActivity();
  const [calendarProvider, setCalendarProvider] = useState(calendarProviderDefault);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [slot, setSlot] = useState(defaultRange);
  const [formError, setFormError] = useState<string | null>(null);
  const activity = useContext(InboxActivityContext);
  const composeRequest = activity?.composeRequest ?? 0;
  const [handledComposeRequest, setHandledComposeRequest] = useState(composeRequest);
  const [composeSeed, setComposeSeed] = useState<MailReplySeed | null>(null);
  const [openMail, setOpenMail] = useState<MailRow | null>(null);
  const [openEvent, setOpenEvent] = useState<EventRow | null>(null);
  if (composeRequest !== handledComposeRequest) {
    setHandledComposeRequest(composeRequest);
    if (composeSeed) {
      setComposeSeed(null);
    }
  }

  function beginReply(message: MailRow, body: string) {
    const provider = mailProviderId(message.provider);
    if (!provider) {
      return "This mailbox cannot send a reply from here.";
    }
    const built = buildMailReplySeed({
      messageId: message.id,
      provider,
      fromAddress: message.fromAddress,
      subject: message.subject,
      whenLabel: formatWhen(message.receivedAt),
      body,
    });
    if (!built.ok) {
      return built.error;
    }
    setOpenMail(null);
    setComposeSeed(built.seed);
    return null;
  }

  function beginRemove(event: EventRow, titleText: string) {
    const provider = calendarProviderId(event.provider);
    if (!provider) {
      return "This calendar cannot remove the event from here.";
    }
    const built = buildDeleteCalendarAction({
      provider,
      eventId: event.id,
      title: titleText || event.title,
    });
    if (!built.ok) {
      return built.error;
    }
    try {
      onStage(built.action);
    } catch (error) {
      return error instanceof Error ? error.message : "Could not stage that removal.";
    }
    setOpenEvent(null);
    return null;
  }

  function stageEvent() {
    const range = allDay
      ? localDayRange(slot.day, slot.endDay)
      : { startsAt: slot.start, endsAt: slot.end };
    if (!range) {
      setFormError("Choose a valid day range.");
      return;
    }
    const built = buildCalendarEventAction({
      provider: calendarProvider,
      title,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      allDay,
      description,
    });
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    try {
      onStage(built.action);
      setFormError(null);
      setDescription("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not stage that event.");
    }
  }

  const loading = mail.isLoading || events.isLoading;
  const loadError = mail.error || events.error;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#070b12] text-white">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5 sm:px-4">
        {showBack ? (
          <button
            type="button"
            className="inbox-pane-back rounded-full px-2 py-1 text-xs text-white/70"
            onClick={onBack}
          >
            {t("mail.back")}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("mail.title")}</p>
          <p className="truncate text-[11px] text-white/40">
            {t("mail.subtitle")}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs text-white/55 hover:text-white"
            onClick={onClose}
          >
            {t("mail.close")}
          </button>
        ) : null}
      </div>
      <div
        role="tablist"
        aria-label={t("mail.aria")}
        className="grid grid-cols-3 gap-1 px-3 py-2 sm:px-4"
      >
        {(
          [
            ["agenda", t("mail.agenda"), List],
            ["email", t("mail.compose"), Mail],
            ["event", t("mail.schedule"), CalendarDays],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium transition-colors ${
              view === id
                ? "bg-white text-black"
                : "bg-white/[0.04] text-white/65 hover:bg-white/[0.08]"
            }`}
            onClick={() => {
              setFormError(null);
              onViewChange(id);
            }}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div
        className={`min-h-0 flex-1 px-3 pb-3 sm:px-4 ${
          view === "event" ? "overflow-y-auto overscroll-contain" : "flex flex-col overflow-hidden"
        }`}
      >
        {view === "agenda" || view === "email" ? (
          <div className="inbox-agenda-frame">
            {loading ? (
              <p className="text-xs text-white/45">{t("mail.loading")}</p>
            ) : null}
            {loadError ? (
              <p role="alert" className="text-xs text-red-300">
                {t("mail.loadError")}
              </p>
            ) : null}
            <div className="inbox-agenda-grid">
              <section className="inbox-agenda-card">
                <h3 className="flex items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  <CalendarDays aria-hidden="true" className="size-3.5" />
                  {t("mail.upcoming")}
                </h3>
                <div className="min-h-0 flex-1">
                  {upcoming.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-white/45">No upcoming events in the mirror.</p>
                  ) : (
                    <ActivityRows
                      items={upcoming}
                      renderItem={(event) => (
                        <EventLine
                          event={event}
                          onOpen={(item) => {
                            setOpenMail(null);
                            setOpenEvent(item);
                          }}
                        />
                      )}
                    />
                  )}
                </div>
              </section>
              <section className="inbox-agenda-card">
                <h3 className="flex items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  <Mail aria-hidden="true" className="size-3.5" />
                  {t("mail.recent")}
                </h3>
                <div className="min-h-0 flex-1">
                  {recentMail.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-white/45">No mirrored mail yet.</p>
                  ) : (
                    <ActivityRows
                      items={recentMail}
                      renderItem={(message) => (
                        <MailLine
                          message={message}
                          onOpen={(item) => {
                            setOpenEvent(null);
                            setOpenMail(item);
                          }}
                        />
                      )}
                    />
                  )}
                </div>
              </section>
            </div>
            <p className="shrink-0 pt-2 text-[11px] leading-relaxed text-white/35">
              Open a message or event to read it. The mirror still keeps subject, sender, and a short snippet.{" "}
              <Link href="/settings/integrations" className="underline underline-offset-2">
                Connect or upgrade scopes
              </Link>
            </p>
          </div>
        ) : null}
        {view === "email" || composeSeed ? (
          <InboxComposeLetter
            key={composeSeed?.messageId ?? "new"}
            open
            initial={composeSeed}
            emailProvider={composeSeed?.provider ?? emailProviderDefault}
            onClose={() => {
              setComposeSeed(null);
              onViewChange("agenda");
            }}
            onStage={onStage}
          />
        ) : null}
        {view === "event" ? (
          <form
            className="mx-auto w-full max-w-2xl space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              stageEvent();
            }}
          >
            <label className="block space-y-1 text-xs text-white/55">
              {t("mail.calendar")}
              <select
                className="h-11 w-full rounded-2xl border border-white/10 bg-[#10151e] px-3 text-sm text-white"
                value={calendarProvider}
                onChange={(event) =>
                  setCalendarProvider(event.target.value as "google" | "outlook")
                }
              >
                <option value="google">Google Calendar</option>
                <option value="outlook">Outlook Calendar</option>
              </select>
            </label>
            <label className="block space-y-1 text-xs text-white/55">
              {t("mail.eventTitle")}
              <Input dir="auto"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder={t("mail.eventPlaceholder")}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(event) => setAllDay(event.target.checked)}
              />
              {t("mail.allDay")}
            </label>
            {allDay ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-white/55">
                  Start
                  <Input
                    type="date"
                    value={slot.day}
                    onChange={(event) =>
                      setSlot((current) => ({ ...current, day: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1 text-xs text-white/55">
                  End
                  <Input
                    type="date"
                    value={slot.endDay}
                    onChange={(event) =>
                      setSlot((current) => ({ ...current, endDay: event.target.value }))
                    }
                  />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-white/55">
                  {t("mail.starts")}
                  <Input
                    type="datetime-local"
                    value={slot.start}
                    onChange={(event) =>
                      setSlot((current) => ({ ...current, start: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1 text-xs text-white/55">
                  {t("mail.ends")}
                  <Input
                    type="datetime-local"
                    value={slot.end}
                    onChange={(event) =>
                      setSlot((current) => ({ ...current, end: event.target.value }))
                    }
                  />
                </label>
              </div>
            )}
            <label className="block space-y-1 text-xs text-white/55">
              {t("mail.notes")}
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-(--accent)/50"
                placeholder={t("mail.optional")}
              />
            </label>
            <p className="text-[11px] leading-relaxed text-white/40">
              {t("mail.calendarNote")}
            </p>
            {formError ? (
              <p role="alert" className="text-xs text-red-300">{formError}</p>
            ) : null}
            <Button type="submit" size="sm">
              {t("mail.stageEvent")}
            </Button>
          </form>
        ) : null}
      </div>
      {openMail ? (
        <MailDetailLetter
          message={openMail}
          onClose={() => setOpenMail(null)}
          onReply={(body) => beginReply(openMail, body)}
        />
      ) : null}
      {openEvent ? (
        <EventDetailLetter
          event={openEvent}
          onClose={() => setOpenEvent(null)}
          onRemove={(titleText) => beginRemove(openEvent, titleText)}
        />
      ) : null}
    </div>
  );
}

function MailLine({
  message,
  onOpen,
}: {
  message: MailRow;
  onOpen: (message: MailRow) => void;
}) {
  return (
    <button
      type="button"
      className="inbox-agenda-row"
      onClick={() => onOpen(message)}
    >
      <Mail aria-hidden="true" className="size-4 shrink-0 text-(--accent)" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white/90">{message.subject || "(no subject)"}</span>
        <span className="block truncate text-[11px] text-white/40">{message.fromAddress}</span>
      </span>
      <time className="shrink-0 text-[11px] text-white/40" dateTime={message.receivedAt}>
        {formatWhen(message.receivedAt)}
      </time>
    </button>
  );
}

function EventLine({
  event,
  onOpen,
}: {
  event: EventRow;
  onOpen: (event: EventRow) => void;
}) {
  return (
    <button
      type="button"
      className="inbox-agenda-row"
      onClick={() => onOpen(event)}
    >
      <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-(--accent)" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white/90">{event.title}</span>
        <span className="block truncate text-[11px] text-white/40">
          {event.accountEmail || event.provider}
        </span>
      </span>
      <time className="shrink-0 text-[11px] text-white/40" dateTime={event.startsAt}>
        {formatWhen(event.startsAt, event.allDay)}
      </time>
    </button>
  );
}

function DetailLetter({
  titleId,
  kicker,
  title,
  closeLabel,
  onClose,
  children,
  footer,
}: {
  titleId: string;
  kicker: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>("button, a[href], textarea")]
        .filter((node) => !node.hasAttribute("disabled"));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="inbox-letter-stage">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        className="inbox-letter"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-black/10 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-black/55">
              <SophiaMark />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">{kicker}</p>
            </div>
            <h2 id={titleId} className="mt-2 truncate text-xl font-semibold tracking-tight">
              {title}
            </h2>
          </div>
          <button type="button" className="inbox-letter-icon" aria-label={closeLabel} onClick={onClose}>
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-black/10 px-5 py-4">
          {footer}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function MailDetailLetter({
  message,
  onClose,
  onReply,
}: {
  message: MailRow;
  onClose: () => void;
  onReply: (body: string) => string | null;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const bodyQuery = useQuery({
    queryKey: ["inbox-mail-body", message.id],
    queryFn: () => api.readEmailMessage(message.id),
    staleTime: 0,
    gcTime: 0,
  });
  const body = bodyQuery.data?.body ?? "";

  return (
    <DetailLetter
      titleId="inbox-mail-title"
      kicker="Sophia"
      title={message.subject || "(no subject)"}
      closeLabel="Close message"
      onClose={onClose}
      footer={
        <button
          type="button"
          className="inbox-letter-primary"
          disabled={!bodyQuery.isSuccess}
          onClick={() => {
            const error = onReply(body);
            setActionError(error);
          }}
        >
          Reply
        </button>
      }
    >
      <p className="text-sm">
        <span className="font-medium">{message.fromAddress}</span>
        <span className="mt-1 block text-xs text-black/55">{formatWhen(message.receivedAt)}</span>
      </p>
      {bodyQuery.isLoading ? (
        <p className="text-sm text-black/55">Opening this message…</p>
      ) : null}
      {bodyQuery.isError ? (
        <p role="alert" className="text-sm text-red-800">
          {bodyQuery.error instanceof Error
            ? bodyQuery.error.message
            : "Could not open this message."}
        </p>
      ) : null}
      {bodyQuery.isSuccess ? (
        <div className="inbox-letter-copy">
          {body.trim() ? body : "This message has no text body."}
        </div>
      ) : null}
      {bodyQuery.data?.truncated ? (
        <p className="text-xs text-black/55">The rest of this message was left off because it is very long.</p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-sm text-red-800">{actionError}</p>
      ) : null}
    </DetailLetter>
  );
}

function EventDetailLetter({
  event,
  onClose,
  onRemove,
}: {
  event: EventRow;
  onClose: () => void;
  onRemove: (title: string) => string | null;
}) {
  const { t } = useI18n();
  const [actionError, setActionError] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: ["inbox-event-detail", event.id],
    queryFn: () => api.readCalendarEvent(event.id),
    staleTime: 0,
    gcTime: 0,
  });
  const detail = detailQuery.data;
  const title = detail?.title || event.title;
  const startsAt = detail?.startsAt || event.startsAt;
  const endsAt = detail?.endsAt || event.endsAt;
  const allDay = detail?.allDay ?? event.allDay;
  const attendees = detail?.attendees ?? [];

  return (
    <DetailLetter
      titleId="inbox-event-title"
      kicker="Sophia"
      title={title}
      closeLabel={t("mail.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="inbox-letter-secondary" onClick={onClose}>
            Keep
          </button>
          <button
            type="button"
            className="inbox-letter-danger"
            onClick={() => setActionError(onRemove(title))}
          >
            Remove
          </button>
        </>
      }
    >
      <p className="text-sm">
        <time dateTime={startsAt}>{formatWhen(startsAt, allDay)}</time>
        <span aria-hidden="true"> – </span>
        <time dateTime={endsAt}>{formatWhen(endsAt, allDay)}</time>
        {allDay ? <span className="ms-2 text-xs text-black/55">{t("mail.allDay")}</span> : null}
      </p>
      {detailQuery.isLoading ? (
        <p className="text-sm text-black/55">Opening this event…</p>
      ) : null}
      {detailQuery.isError ? (
        <p role="alert" className="text-sm text-red-800">
          {detailQuery.error instanceof Error
            ? detailQuery.error.message
            : "Could not open this event."}
        </p>
      ) : null}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/45">Location</h3>
        <p className="mt-1 text-sm">{detail?.location || "No location"}</p>
      </section>
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/45">Attendees</h3>
        {attendees.length === 0 ? (
          <p className="mt-1 text-sm">No attendees</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {attendees.map((person) => (
              <li key={`${person.email}-${person.name}`}>
                {person.name || person.email}
                {person.name && person.email ? <span className="text-black/55"> · {person.email}</span> : null}
                {person.status ? <span className="text-black/55"> · {person.status}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/45">Description</h3>
        <div className="inbox-letter-copy mt-1">
          {detail?.description?.trim() ? detail.description : "No description"}
        </div>
      </section>
      {detail?.truncated ? (
        <p className="text-xs text-black/55">The rest of the description was left off because it is very long.</p>
      ) : null}
      <p className="text-xs text-black/55">
        Keep leaves the event where it is. Remove waits for your approval before anything is deleted.
      </p>
      {actionError ? (
        <p role="alert" className="text-sm text-red-800">{actionError}</p>
      ) : null}
    </DetailLetter>
  );
}

function unsupportedAction(): never {
  throw new Error("Open a conversation for that Sophia action.");
}

export function InboxHomeActivity() {
  const { t } = useI18n();
  const context = useContext(InboxActivityContext);
  const [localView, setLocalView] = useState<InboxActivityView>("agenda");
  const view = context?.view ?? localView;
  const setView = context?.setView ?? setLocalView;
  const queryClient = useQueryClient();
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [emailProvider] = useState<"gmail" | "outlook-mail">(
    () => loadJobDefaults(currentUserId()).emailProvider ?? "gmail",
  );
  const [calendarProvider] = useState<"google" | "outlook">(
    () => loadJobDefaults(currentUserId()).calendarProvider ?? "google",
  );

  const runtime = useMemo<AgentRuntime>(() => {
    return createAgentRuntime({
      getContext: () => ({ conversationId: null, recipientUsername: null }),
      onProposalsChanged: setProposals,
      handlers: {
        sendMessage: unsupportedAction,
        webSearch: unsupportedAction,
        ui: unsupportedAction,
        createDocument: unsupportedAction,
        rememberFact: unsupportedAction,
        forgetFact: unsupportedAction,
        draftMessage: unsupportedAction,
        acceptFinding: unsupportedAction,
        dismissFinding: unsupportedAction,
        snoozeReminder: unsupportedAction,
        draftEmail: async (action, approval) => {
          if (!approval?.proposalId) {
            throw new Error("Email changes run only after explicit approval.");
          }
          const payload = emailApiPayload(action);
          if (action.delivery === "send") {
            await api.sendEmail(action.provider, payload, approval.proposalId);
          } else {
            await api.createEmailDraft(action.provider, payload, approval.proposalId);
          }
          await queryClient.invalidateQueries({ queryKey: ["inbox-mail"] });
        },
        createCalendarEvent: async (action) => {
          await api.createCalendarEvent(action.provider, {
            title: action.title,
            startsAt: action.startsAt,
            endsAt: action.endsAt,
            ...(action.allDay ? { allDay: true } : {}),
            ...(action.description ? { description: action.description } : {}),
          });
          await queryClient.invalidateQueries({ queryKey: ["inbox-events"] });
        },
        deleteCalendarEvent: async (action, approval) => {
          if (!approval?.proposalId) {
            throw new Error("Calendar deletes run only after explicit approval.");
          }
          await api.deleteCalendarEvent(
            action.provider,
            action.eventId,
            approval.proposalId,
          );
          await queryClient.invalidateQueries({ queryKey: ["inbox-events"] });
        },
        createGitHubIssue: unsupportedAction,
        createLinearIssue: unsupportedAction,
        postSlackMessage: unsupportedAction,
        proposeFollowUp: unsupportedAction,
        rescheduleCommitment: unsupportedAction,
      },
    });
  }, [queryClient]);

  function stage(action: AgentToolAction) {
    setActionError(null);
    runtime.propose(action, { provenance: "command" });
    setView("agenda");
  }

  async function approve(proposal: AgentProposal) {
    try {
      setActionError(null);
      await runtime.approve(proposal.id);
      setFlash(`Approved · ${agentActionSummary(proposal.action)}`);
      window.setTimeout(() => setFlash((current) => (
        current === `Approved · ${agentActionSummary(proposal.action)}` ? null : current
      )), 2400);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? localizedRuntimeMessage(error.message, t)
          : t("approval.failed"),
      );
    }
  }

  return (
    <div className="inbox-activity-sheet flex h-full min-h-0 w-full flex-col">
      <InboxActivityPanel
        view={view}
        onViewChange={setView}
        onStage={stage}
        emailProvider={emailProvider}
        calendarProvider={calendarProvider}
        showBack={Boolean(context?.mobileOpen)}
        onBack={context?.closeMobile}
      />
      {flash || proposals.length > 0 || actionError ? (
        <div className="max-h-[40%] shrink-0 space-y-2 overflow-y-auto border-t border-white/10 px-3 py-3">
          <SophiaApproveSuccess message={flash} />
          {proposals.map((proposal) => (
            <SophiaProposalCard
              key={proposal.id}
              proposal={proposal}
              onApprove={approve}
              onCancel={(item) => runtime.cancel(item.id)}
            />
          ))}
          {actionError ? (
            <p role="alert" className="text-xs text-red-300">{actionError}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

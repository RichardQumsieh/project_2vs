"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  buildCalendarEventAction,
  buildEmailDraftAction,
  localDayRange,
  sortRecentMail,
  toDatetimeLocalValue,
  upcomingEvents,
  type InboxActivityView,
} from "@/lib/inbox-activity";
import { currentUserId } from "@/lib/session";

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
};

const InboxActivityContext = createContext<InboxActivityContextValue | null>(null);

export function InboxActivityState({
  view,
  setView,
  mobileOpen,
  closeMobile,
  children,
}: InboxActivityContextValue & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ view, setView, mobileOpen, closeMobile }),
    [closeMobile, mobileOpen, setView, view],
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
  const [range, setRange] = useState({ start: 0, end: 8 });
  const itemCount = items.length;

  const measure = useCallback(() => {
    const node = scrollerRef.current;
    if (!node || itemCount === 0) {
      return;
    }
    const start = Math.max(0, Math.floor(node.scrollTop / rowHeight) - 2);
    const end = Math.min(
      itemCount,
      start + Math.ceil(node.clientHeight / rowHeight) + 5,
    );
    setRange((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, [itemCount]);

  if (itemCount === 0) {
    return null;
  }

  const height = Math.min(itemCount * rowHeight, 320);
  const slice = items.slice(range.start, range.end);

  return (
    <div
      ref={scrollerRef}
      onScroll={measure}
      className="overflow-y-auto overscroll-contain"
      style={{ height, contain: "strict" }}
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
  const { mail, events, recentMail, upcoming } = useMirroredActivity();
  const [emailProvider, setEmailProvider] = useState(emailProviderDefault);
  const [calendarProvider, setCalendarProvider] = useState(calendarProviderDefault);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [slot, setSlot] = useState(defaultRange);
  const [formError, setFormError] = useState<string | null>(null);

  function stageEmail() {
    const built = buildEmailDraftAction({
      provider: emailProvider,
      to,
      cc,
      subject,
      body,
    });
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    try {
      onStage(built.action);
      setFormError(null);
      setBody("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not stage that draft.");
    }
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
            className="rounded-full px-2 py-1 text-xs text-white/70 md:hidden"
            onClick={onBack}
          >
            Back
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Mail & calendar</p>
          <p className="truncate text-[11px] text-white/40">
            Newest mail, soonest events. Drafts and events wait for approval.
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            className="rounded-full px-2 py-1 text-xs text-white/55 hover:text-white"
            onClick={onClose}
          >
            Close
          </button>
        ) : null}
      </div>
      <div
        role="tablist"
        aria-label="Mail and calendar"
        className="grid grid-cols-3 gap-1 px-3 py-2 sm:px-4"
      >
        {(
          [
            ["agenda", "Agenda"],
            ["email", "Compose"],
            ["event", "Schedule"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`rounded-full px-2 py-1.5 text-xs font-medium transition-colors ${
              view === id
                ? "bg-white text-black"
                : "bg-white/[0.04] text-white/65 hover:bg-white/[0.08]"
            }`}
            onClick={() => {
              setFormError(null);
              onViewChange(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 sm:px-4">
        {view === "agenda" ? (
          <div className="space-y-4">
            {loading ? (
              <p className="text-xs text-white/45">Loading mirrored mail and events…</p>
            ) : null}
            {loadError ? (
              <p role="alert" className="text-xs text-red-300">
                Could not load mail or calendar. Connect an account in Integrations, then sync.
              </p>
            ) : null}
            <section className="space-y-2">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/40">
                Upcoming
              </h3>
              {upcoming.length === 0 ? (
                <p className="text-xs text-white/45">No upcoming events in the mirror.</p>
              ) : (
                <ActivityRows
                  items={upcoming}
                  renderItem={(event) => (
                    <EventLine event={event} />
                  )}
                />
              )}
            </section>
            <section className="space-y-2">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/40">
                Recent mail
              </h3>
              {recentMail.length === 0 ? (
                <p className="text-xs text-white/45">No mirrored mail yet.</p>
              ) : (
                <ActivityRows
                  items={recentMail}
                  renderItem={(message) => (
                    <MailLine message={message} />
                  )}
                />
              )}
            </section>
            <p className="text-[11px] leading-relaxed text-white/35">
              Subject, sender, and time only — not full bodies.{" "}
              <Link href="/settings/integrations" className="underline underline-offset-2">
                Connect or upgrade scopes
              </Link>
            </p>
          </div>
        ) : null}
        {view === "email" ? (
          <form
            className="inbox-activity-compose space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              stageEmail();
            }}
          >
            <label className="block space-y-1 text-xs text-white/55">
              Mailbox
              <select
                className="h-11 w-full rounded-2xl border border-white/10 bg-[#10151e] px-3 text-sm text-white"
                value={emailProvider}
                onChange={(event) =>
                  setEmailProvider(event.target.value as "gmail" | "outlook-mail")
                }
              >
                <option value="gmail">Gmail draft</option>
                <option value="outlook-mail">Outlook draft</option>
              </select>
            </label>
            <label className="block space-y-1 text-xs text-white/55">
              To
              <Input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                inputMode="email"
              />
            </label>
            <label className="block space-y-1 text-xs text-white/55">
              Cc
              <Input
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="block space-y-1 text-xs text-white/55">
              Subject
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={200}
              />
            </label>
            <label className="block space-y-1 text-xs text-white/55">
              Message
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={6}
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-(--accent)/50"
                placeholder="Write the draft. It is not sent."
              />
            </label>
            <p className="text-[11px] leading-relaxed text-white/40">
              Stage a draft. Approval creates it in Gmail or Outlook. This inbox does not send mail.
            </p>
            {formError ? (
              <p role="alert" className="text-xs text-red-300">{formError}</p>
            ) : null}
            <Button type="submit" size="sm">
              Stage draft for approval
            </Button>
          </form>
        ) : null}
        {view === "event" ? (
          <form
            className="inbox-activity-compose space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              stageEvent();
            }}
          >
            <label className="block space-y-1 text-xs text-white/55">
              Calendar
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
              Title
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder="30m with Dana"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(event) => setAllDay(event.target.checked)}
              />
              All day
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
                  Starts
                  <Input
                    type="datetime-local"
                    value={slot.start}
                    onChange={(event) =>
                      setSlot((current) => ({ ...current, start: event.target.value }))
                    }
                  />
                </label>
                <label className="space-y-1 text-xs text-white/55">
                  Ends
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
              Notes
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-white outline-none focus:border-(--accent)/50"
                placeholder="Optional"
              />
            </label>
            <p className="text-[11px] leading-relaxed text-white/40">
              Nothing is written to the calendar until you approve the exact event.
            </p>
            {formError ? (
              <p role="alert" className="text-xs text-red-300">{formError}</p>
            ) : null}
            <Button type="submit" size="sm">
              Stage event for approval
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function MailLine({ message }: { message: MailRow }) {
  return (
    <div className="flex h-full flex-col justify-center border-b border-white/[0.06] pr-1">
      <p className="truncate text-sm text-white/90">{message.subject || "(no subject)"}</p>
      <p className="truncate text-[11px] text-white/40">
        {message.fromAddress} · {formatWhen(message.receivedAt)}
      </p>
    </div>
  );
}

function EventLine({ event }: { event: EventRow }) {
  return (
    <div className="flex h-full flex-col justify-center border-b border-white/[0.06] pr-1">
      <p className="truncate text-sm text-white/90">{event.title}</p>
      <p className="truncate text-[11px] text-white/40">
        {formatWhen(event.startsAt, event.allDay)}
        {event.accountEmail ? ` · ${event.accountEmail}` : ""}
      </p>
    </div>
  );
}

function unsupportedAction(): never {
  throw new Error("Open a conversation for that Sophia action.");
}

export function InboxHomeActivity() {
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
        draftEmail: async (action) => {
          await api.createEmailDraft(action.provider, {
            to: action.to,
            subject: action.subject,
            body: action.body,
            ...(action.cc ? { cc: action.cc } : {}),
          });
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
        error instanceof Error ? error.message : "The approved action could not be completed.",
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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

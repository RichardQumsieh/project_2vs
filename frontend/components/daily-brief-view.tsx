"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { briefCopy } from "@/lib/daily-brief/copy";
import { formatBriefWhen } from "@/lib/daily-brief/format";
import type { BriefPendingReason, BriefPreference, BriefSuggestedAction, DailyBriefDocument } from "@/lib/daily-brief/types";
import { LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n } from "@/lib/i18n/locale";

const card = "rounded-2xl border border-(--line) bg-(--surface) p-4";
const field = "mt-1 w-full min-h-11 rounded-xl border border-(--line) bg-(--control-bg) px-3 text-base text-(--foreground)";
const button =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background) disabled:opacity-50";
const quiet =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-(--line) px-4 text-sm text-(--foreground) disabled:opacity-50";

export function DailyBriefView({
  onClose,
  preference,
  brief,
  pendingReason,
  status,
  error,
  busy,
  onSave,
  onPrepare,
  onApprove,
}: {
  onClose?: () => void;
  preference: BriefPreference;
  brief: DailyBriefDocument | null;
  pendingReason: BriefPendingReason | null;
  status: string | null;
  error: string | null;
  busy: boolean;
  onSave: (preference: BriefPreference) => Promise<void> | void;
  onPrepare: () => Promise<void> | void;
  onApprove: (action: BriefSuggestedAction) => Promise<void> | void;
}) {
  const { locale } = useI18n();
  const [time, setTime] = useState(preference.briefTime);
  const [language, setLanguage] = useState(preference.language);
  const [zone, setZone] = useState(preference.timeZone);
  useEffect(() => {
    setTime(preference.briefTime);
    setLanguage(preference.language);
    setZone(preference.timeZone);
  }, [preference.briefTime, preference.language, preference.timeZone]);
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const text = (key: Parameters<typeof briefCopy>[1], vars?: Record<string, string | number>) =>
    briefCopy(locale, key, vars);

  async function save(event: FormEvent) {
    event.preventDefault();
    await onSave({ briefTime: time, language, timeZone: zone });
  }

  async function approve(action: BriefSuggestedAction) {
    setWorking(action.id);
    try {
      await onApprove(action);
      setApproved((current) => ({ ...current, [action.id]: "done" }));
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-4 pb-10">
      <header className="flex flex-wrap items-center gap-2">
        {onClose ? (
          <button
            type="button"
            className="min-h-11 rounded-full px-1 text-sm text-(--muted)"
            title={text("back")}
            aria-label={text("back")}
            onClick={onClose}
          >
            {text("back")}
          </button>
        ) : (
          <Link href="/inbox?hub=mail" className="min-h-11 rounded-full px-1 text-sm text-(--muted)" title={text("back")} aria-label={text("back")}>
            {text("back")}
          </Link>
        )}
        <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">{text("title")}</h1>
        <LanguageSwitcher />
      </header>
      <p className="text-sm leading-6 text-(--muted)">{text("intro")}</p>
      <form className={card} onSubmit={save}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            {text("time")}
            <input
              className={field}
              dir="ltr"
              type="time"
              title={text("time")}
              aria-label={text("time")}
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            {text("briefLanguage")}
            <select
              className={field}
              title={text("briefLanguage")}
              aria-label={text("briefLanguage")}
              value={language}
              onChange={(event) => setLanguage(event.target.value === "ar" ? "ar" : "en")}
            >
              <option value="en">{text("english")}</option>
              <option value="ar">{text("arabic")}</option>
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm">
          {text("zone")}
          <input
            className={field}
            dir="ltr"
            title={text("zone")}
            aria-label={text("zone")}
            value={zone}
            onChange={(event) => setZone(event.target.value)}
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={button} type="submit" disabled={busy} title={text("save")} aria-label={text("save")}>{text("save")}</button>
          <button className={quiet} type="button" disabled={busy} title={text("prepare")} aria-label={text("prepare")} onClick={() => void onPrepare()}>
            {busy ? text("preparing") : text("prepare")}
          </button>
        </div>
        {status ? <p className="mt-3 text-sm text-(--muted)">{status}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-(--danger)">{error}</p> : null}
      </form>

      {brief ? (
        <article className="flex flex-col gap-4" aria-label={text("title")}>
          <p className={`${card} text-base leading-7`} dir="auto">{brief.narrative}</p>
          <section className={card} aria-labelledby="brief-meetings">
            <h2 id="brief-meetings" className="text-sm font-semibold">{text("meetings")}</h2>
            {brief.meetings.length === 0 ? (
              <p className="mt-2 text-sm text-(--muted)">{text("noMeetings")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {brief.meetings.map((meeting) => (
                  <li key={meeting.id} className="border-t border-(--line) pt-3 first:border-t-0 first:pt-0">
                    <p className="font-medium" dir="auto">{meeting.title}</p>
                    <p className="text-sm text-(--muted)">
                      <LtrIsolate>{formatBriefWhen(meeting.startsAt, brief.timeZone, locale)}</LtrIsolate>
                    </p>
                    <p className="mt-1 text-sm leading-6" dir="auto">{meeting.prepNote}</p>
                    {meeting.conflictsWith.map((title) => (
                      <p key={title} className="mt-1 text-sm text-(--danger)" dir="auto">
                        {text("conflict", { title })}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-labelledby="brief-replies">
            <h2 id="brief-replies" className="text-sm font-semibold">{text("replies")}</h2>
            {brief.needsReply.length === 0 ? (
              <p className="mt-2 text-sm text-(--muted)">{text("noReplies")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {brief.needsReply.map((message) => (
                  <li key={message.id}>
                    <p className="text-xs uppercase tracking-wide text-(--muted)">{text(message.urgency)}</p>
                    <p className="font-medium" dir="auto">{message.subject}</p>
                    <p className="text-sm text-(--muted)"><LtrIsolate className="break-all">{message.fromAddress}</LtrIsolate></p>
                    <p className="text-sm" dir="auto">{message.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-labelledby="brief-overdue">
            <h2 id="brief-overdue" className="text-sm font-semibold">{text("overdue")}</h2>
            {brief.overdueFollowUps.length === 0 ? (
              <p className="mt-2 text-sm text-(--muted)">{text("noOverdue")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {brief.overdueFollowUps.map((message) => (
                  <li key={message.id}>
                    <p className="font-medium" dir="auto">{message.subject}</p>
                    <p className="text-sm text-(--muted)"><LtrIsolate className="break-all">{message.fromAddress}</LtrIsolate></p>
                    <p className="text-sm">{text("days", { count: message.daysOverdue })}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card} aria-labelledby="brief-actions">
            <h2 id="brief-actions" className="text-sm font-semibold">{text("actions")}</h2>
            <p className="mt-1 text-sm text-(--muted)">{text("approvalHint")}</p>
            {brief.actions.length === 0 ? (
              <p className="mt-2 text-sm text-(--muted)">{text("noActions")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-4">
                {brief.actions.map((action) => {
                  const label = action.kind === "draft_reply"
                    ? text("approveDraft")
                    : action.kind === "reschedule"
                      ? text("approveMove")
                      : text("approveDecline");
                  const done = approved[action.id];
                  return (
                    <li key={action.id} className="border-t border-(--line) pt-3">
                      <h3 className="font-medium" dir="auto">{action.title}</h3>
                      <p className="mt-1 text-sm leading-6" dir="auto">{action.detail}</p>
                      <ActionPayload action={action} locale={locale} timeZone={brief.timeZone} />
                      <button
                        type="button"
                        className={`${button} mt-3 w-full`}
                        title={done ? text("approved") : label}
                        aria-label={done ? text("approved") : label}
                        disabled={busy || working === action.id || Boolean(done)}
                        onClick={() => void approve(action)}
                      >
                        {done ? text("approved") : working === action.id ? text("approving") : label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </article>
      ) : pendingReason === "not_connected" ? (
        <section className={card} aria-labelledby="brief-connect">
          <h2 id="brief-connect" className="text-base font-semibold">{text("connectTitle")}</h2>
          <p className="mt-2 text-sm leading-6">{text("connectBody")}</p>
          <Link href="/settings/integrations" className={`${button} mt-4`}>
            {text("connectLink")}
          </Link>
        </section>
      ) : (
        <p className={`${card} text-sm leading-6`}>
          {pendingReason === "before_brief_time"
            ? text("waiting", { time: preference.briefTime })
            : text("empty")}
        </p>
      )}
    </div>
  );
}

function ActionPayload({
  action,
  locale,
  timeZone,
}: {
  action: BriefSuggestedAction;
  locale: "en" | "ar";
  timeZone: string;
}) {
  const approval = action.approval;
  if (approval.action === "save_draft") {
    return (
      <div className="mt-2 text-sm leading-6" dir="auto">
        <p><LtrIsolate className="break-all">{approval.payload.to.join(", ")}</LtrIsolate></p>
        <p>{approval.payload.subject}</p>
        <p>{approval.payload.body}</p>
      </div>
    );
  }
  if (approval.action === "reschedule_event") {
    return (
      <p className="mt-2 text-sm">
        <LtrIsolate>
          {formatBriefWhen(approval.payload.startsAt, timeZone, locale)}
          {" – "}
          {formatBriefWhen(approval.payload.endsAt, timeZone, locale)}
        </LtrIsolate>
      </p>
    );
  }
  return null;
}

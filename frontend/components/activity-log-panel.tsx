"use client";

import { useEffect, useState } from "react";
import { ApiError, api, type AccountActivityEvent } from "@/lib/api";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

const actionKeys: Record<string, MessageKey> = {
  LOGIN: "activity.login",
  CLOUD_CONSENT_GRANTED: "activity.consentOn",
  CLOUD_CONSENT_WITHDRAWN: "activity.consentOff",
  SETTING_CHANGED: "activity.setting",
  EMAIL_SENT: "activity.emailSent",
  CALENDAR_DELETE_APPROVED: "activity.calendarDelete",
  BUTTON_ACTION: "activity.action",
};

export function ActivityLogPanel() {
  const { t } = useI18n();
  const [events, setEvents] = useState<AccountActivityEvent[]>([]);
  const [recorded, setRecorded] = useState<string[]>([]);
  const [notRecorded, setNotRecorded] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const page = await api.listActivity();
    setEvents(page.events);
    setRecorded(page.recorded);
    setNotRecorded(page.notRecorded);
    setTruncated(page.truncated);
  }

  useEffect(() => {
    let active = true;
    void api.listActivity().then(
      (page) => {
        if (!active) return;
        setEvents(page.events);
        setRecorded(page.recorded);
        setNotRecorded(page.notRecorded);
        setTruncated(page.truncated);
      },
      (loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof ApiError ? loadError.message : "Could not load your activity log.");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function exportLog() {
    setBusy(true);
    setError(null);
    try {
      const document = await api.exportActivity();
      const blob = new Blob([JSON.stringify(document, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = "sophia-activity-log.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(document.truncated
        ? "Exported the stored log. The file was capped."
        : "Exported your activity log.");
    } catch (exportError) {
      setError(exportError instanceof ApiError ? exportError.message : "Could not export your activity log.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteLog() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.deleteActivity();
      setArmed(false);
      setNotice(`Deleted ${result.deleted} activity ${result.deleted === 1 ? "event" : "events"}.`);
      await reload();
    } catch (deleteError) {
      setError(deleteError instanceof ApiError ? deleteError.message : "Could not delete your activity log.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-relaxed text-white/65 sm:p-6">
        <p>
          {t("activity.intro")}
        </p>
        <p className="mt-3">{t("activity.recorded")}: {recorded.join("; ") || t("activity.loading")}</p>
        <p className="mt-2">{t("activity.notRecorded")}: {notRecorded.join("; ") || t("activity.loading")}</p>
        <p className="mt-2 text-white/45">
          {t("activity.deleteNote")}
        </p>
      </section>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full bg-white px-4 py-2 text-sm text-black disabled:opacity-40"
          disabled={busy}
          onClick={() => void exportLog()}
        >
          {t("activity.export")}
        </button>
        <button
          type="button"
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 disabled:opacity-40"
          disabled={busy}
          onClick={() => void deleteLog()}
        >
          {armed ? t("activity.confirmDelete") : t("activity.delete")}
        </button>
        {armed ? (
          <button
            type="button"
            className="rounded-full px-4 py-2 text-sm text-white/50"
            onClick={() => setArmed(false)}
          >
            {t("activity.cancel")}
          </button>
        ) : null}
      </div>
      {notice ? <p role="status" className="text-sm text-white/70">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      {truncated ? (
        <p className="text-sm text-white/45">{t("activity.truncated")}</p>
      ) : null}
      {events.length === 0 ? (
        <p className="text-sm text-white/45">No activity yet.</p>
      ) : (
        <ul className="divide-y divide-white/10 rounded-3xl border border-white/10">
          {events.map((event) => (
            <li key={event.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-white">
                  <span className="text-white/50">{event.actor}</span>
                  {" · "}
                  {actionKeys[event.action] ? t(actionKeys[event.action]) : event.action}
                </p>
                <time className="text-xs text-white/40" dateTime={event.occurredAt}>
                  {new Date(event.occurredAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-1 text-sm text-white/65">{event.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { DailyBriefView } from "@/components/daily-brief-view";
import { ApiError, api } from "@/lib/api";
import { approveBriefAction } from "@/lib/daily-brief/approve";
import { briefCopy } from "@/lib/daily-brief/copy";
import { dailyBriefEnabled } from "@/lib/daily-brief/flag";
import { sampleDailyBrief } from "@/lib/daily-brief/sample";
import type { BriefPendingReason, BriefPreference, BriefSuggestedAction, DailyBriefDocument } from "@/lib/daily-brief/types";
import { useI18n } from "@/lib/i18n/locale";
import Link from "next/link";

const fallbackPreference: BriefPreference = {
  briefTime: "07:00",
  language: "en",
  timeZone: "Asia/Amman",
};

export function DailyBriefScreen({
  mode,
  disconnected = false,
  onClose,
}: {
  mode: "live" | "preview";
  disconnected?: boolean;
  onClose?: () => void;
}) {
  const { locale, t } = useI18n();
  const enabled = dailyBriefEnabled();
  const [preference, setPreference] = useState<BriefPreference>(
    mode === "preview" ? { ...fallbackPreference, language: locale === "ar" ? "ar" : "en" } : fallbackPreference,
  );
  const [brief, setBrief] = useState<DailyBriefDocument | null>(
    mode === "preview" && !disconnected ? sampleDailyBrief(locale === "ar" ? "ar" : "en") : null,
  );
  const [pendingReason, setPendingReason] = useState<BriefPendingReason | null>(
    mode === "preview" && disconnected ? "not_connected" : null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [touched, setTouched] = useState(false);

  function explain(caught: unknown) {
    if (caught instanceof ApiError && caught.code === "daily_brief_plan") return t("activity.briefPlan");
    return caught instanceof Error ? caught.message : briefCopy(locale, "error");
  }

  const applySample = useCallback((next: BriefPreference) => {
    setPreference(next);
    setBrief(sampleDailyBrief(next.language));
    setPendingReason(null);
  }, []);

  useEffect(() => {
    if (mode !== "preview" || touched || disconnected) return;
    const language = locale === "ar" ? "ar" : "en";
    setPreference((current) => ({ ...current, language }));
    setBrief(sampleDailyBrief(language));
  }, [disconnected, locale, mode, touched]);

  useEffect(() => {
    if (mode !== "live" || !enabled) return;
    let cancel = false;
    setBusy(true);
    api.dailyBrief().then((result) => {
      if (cancel) return;
      setPreference(result.preference);
      setBrief(result.brief);
      setPendingReason(result.pendingReason);
    }).catch((caught) => {
      if (cancel) return;
      if (caught instanceof ApiError && caught.status === 401) {
        setSignedOut(true);
        return;
      }
      setError(explain(caught));
    }).finally(() => {
      if (!cancel) setBusy(false);
    });
    return () => {
      cancel = true;
    };
  }, [enabled, locale, mode, t]);

  if (!enabled) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-2xl font-semibold">{briefCopy(locale, "title")}</h1>
        <p className="mt-3 text-sm leading-6 text-(--muted)">{briefCopy(locale, "off")}</p>
      </div>
    );
  }

  if (signedOut) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-2xl font-semibold">{briefCopy(locale, "title")}</h1>
        <p className="mt-3 text-sm leading-6 text-(--muted)">{briefCopy(locale, "signIn")}</p>
        <Link className="mt-4 inline-flex min-h-11 items-center rounded-full bg-(--foreground) px-4 text-sm text-(--background)" href="/login">
          {briefCopy(locale, "login")}
        </Link>
      </div>
    );
  }

  return (
    <DailyBriefView
      onClose={onClose}
      preference={preference}
      brief={brief}
      pendingReason={pendingReason}
      status={status}
      error={error}
      busy={busy}
      onSave={async (next) => {
        setError(null);
        if (mode === "preview") {
          setTouched(true);
          if (disconnected) {
            setPreference(next);
            setBrief(null);
            setPendingReason("not_connected");
            setStatus(briefCopy(locale, "saved"));
            return;
          }
          applySample(next);
          setStatus(briefCopy(locale, "saved"));
          return;
        }
        setBusy(true);
        try {
          const result = await api.saveDailyBriefPreference(next);
          setPreference(result.preference);
          setBrief(result.brief);
          setPendingReason(result.pendingReason);
          setStatus(briefCopy(locale, "saved"));
        } catch (caught) {
          setError(explain(caught));
        } finally {
          setBusy(false);
        }
      }}
      onPrepare={async () => {
        setError(null);
        if (mode === "preview") {
          if (disconnected) {
            setBrief(null);
            setPendingReason("not_connected");
            setStatus(null);
            return;
          }
          applySample(preference);
          setStatus(briefCopy(locale, "saved"));
          return;
        }
        setBusy(true);
        try {
          const result = await api.generateDailyBrief();
          setPreference(result.preference);
          setBrief(result.brief);
          setPendingReason(result.pendingReason);
          setStatus(null);
        } catch (caught) {
          setError(explain(caught));
        } finally {
          setBusy(false);
        }
      }}
      onApprove={async (action) => {
        if (mode === "preview") {
          setStatus(briefCopy(locale, "previewApproved"));
          return;
        }
        await approveBriefAction(action, {
          createEmailDraft: api.createEmailDraft,
          updateCalendarEvent: api.updateCalendarEvent,
          deleteCalendarEvent: api.deleteCalendarEvent,
        });
        setStatus(briefCopy(locale, "approved"));
      }}
    />
  );
}

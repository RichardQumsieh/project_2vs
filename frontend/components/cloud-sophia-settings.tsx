"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api";
import { logAccountActivity } from "@/lib/account-activity";
import {
  CLOUD_SOPHIA_CONSENT_VERSION,
  CLOUD_SOPHIA_PURPOSE,
} from "@/lib/cloud-sophia";
import { useI18n } from "@/lib/i18n/locale";

type ConsentStatus = {
  active: boolean;
  purposeText: string;
  versionId: string;
  consent: {
    id: string;
    purposeText: string;
    versionId: string;
    grantedAt: string;
    withdrawnAt: string | null;
  } | null;
};

function messageFrom(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Cloud Sophia could not complete that request.";
}

export function CloudSophiaSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const next = await api.cloudSophiaConsent();
    setStatus(next);
  }

  useEffect(() => {
    let active = true;
    void api.cloudSophiaConsent().then(
      (next) => {
        if (active) setStatus(next);
      },
      (loadError: unknown) => {
        if (active) setError(messageFrom(loadError));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function grant() {
    if (!checked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.grantCloudSophiaConsent({
        accepted: true,
        purposeText: CLOUD_SOPHIA_PURPOSE,
        versionId: CLOUD_SOPHIA_CONSENT_VERSION,
      });
      logAccountActivity({
        action: "SETTING_CHANGED",
        summary: "Granted cloud Sophia consent",
        subjectKind: "consent",
        subjectId: CLOUD_SOPHIA_CONSENT_VERSION,
      });
      setChecked(false);
      await reload();
    } catch (grantError) {
      setError(messageFrom(grantError));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.withdrawCloudSophiaConsent();
      logAccountActivity({
        action: "SETTING_CHANGED",
        summary: "Withdrew cloud Sophia consent",
        subjectKind: "consent",
        subjectId: CLOUD_SOPHIA_CONSENT_VERSION,
      });
      await reload();
    } catch (withdrawError) {
      setError(messageFrom(withdrawError));
    } finally {
      setBusy(false);
    }
  }

  const grantedLabel = status?.consent?.grantedAt
    ? new Date(status.consent.grantedAt).toLocaleString()
    : null;

  if (!status) {
    return (
      <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
        <h2 className="text-base font-medium text-white">{t("cloud.title")}</h2>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>
        ) : (
          <p className="mt-3 text-sm text-white/55">{t("cloud.checking")}</p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
      <h2 className="text-base font-medium text-white">{t("cloud.title")}</h2>
      <p className="text-sm leading-relaxed text-white/65">
        {t("cloud.off")}
      </p>
      <blockquote className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-relaxed text-white/80">
        {CLOUD_SOPHIA_PURPOSE}
      </blockquote>
      <p className="text-xs text-white/45">
        {t("cloud.version", { version: CLOUD_SOPHIA_CONSENT_VERSION })}
        {status?.active && grantedLabel ? ` · granted ${grantedLabel}` : ""}
        {status?.consent?.withdrawnAt
          ? ` · withdrawn ${new Date(status.consent.withdrawnAt).toLocaleString()}`
          : ""}
      </p>
      {status?.active ? (
        <div className="space-y-4">
          <p className="text-sm text-white/65">
            {t("cloud.connectedMeta")}
          </p>
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-40"
            title={t("cloud.withdraw")}
            aria-label={t("cloud.withdraw")}
            disabled={busy}
            onClick={() => void withdraw()}
          >
            {t("cloud.withdraw")}
          </button>
          <p className="text-sm leading-6 text-white/70">{t("agent.separate")}</p>
          <Link
            href="/inbox?hub=assistant"
            className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm text-black"
            title={t("agent.separate")}
            aria-label={t("inbox.hub.assistant")}
          >
            {t("inbox.hub.assistant")}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-white/55">
            {t("cloud.unchecked")}
          </p>
          <label className="flex items-start gap-3 text-sm text-white/75">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              className="mt-1 accent-white"
            title={t("cloud.agree")}
            aria-label={t("cloud.agree")}
            />
            {t("cloud.agree")}
          </label>
          <button
            type="button"
            className="rounded-full bg-white px-4 py-2 text-sm text-black disabled:opacity-40"
            title={t("cloud.save")}
            aria-label={t("cloud.save")}
            disabled={!checked || busy}
            onClick={() => void grant()}
          >
            {t("cloud.save")}
          </button>
          <p className="text-sm leading-6 text-white/70">{t("agent.separate")}</p>
          <Link
            href="/inbox?hub=assistant"
            className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 text-sm text-white"
            title={t("agent.separate")}
            aria-label={t("inbox.hub.assistant")}
          >
            {t("inbox.hub.assistant")}
          </Link>
        </div>
      )}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}

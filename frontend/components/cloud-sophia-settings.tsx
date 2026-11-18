"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "@/lib/api";
import { logAccountActivity } from "@/lib/account-activity";
import {
  CLOUD_SOPHIA_CONSENT_VERSION,
  CLOUD_SOPHIA_PURPOSE,
  decideCloudSophiaPath,
} from "@/lib/cloud-sophia";

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
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState<string | null>(null);
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
    setReply(null);
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

  async function ask(event: FormEvent) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || busy) return;
    const decision = decideCloudSophiaPath({
      consentActive: Boolean(status?.active),
      hasPrivateMessagePlaintext: false,
    });
    if (decision !== "cloud") {
      setReply(null);
      setError("Cloud Sophia stays off until you consent. This question was not sent.");
      return;
    }
    setBusy(true);
    setError(null);
    setReply(null);
    try {
      const result = await api.completeCloudSophia({ prompt: question });
      setReply(result.reply);
    } catch (askError) {
      setReply(null);
      setError(messageFrom(askError));
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
        <h2 className="text-base font-medium text-white">Cloud Sophia</h2>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>
        ) : (
          <p className="mt-3 text-sm text-white/55">Checking cloud Sophia consent…</p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
      <h2 className="text-base font-medium text-white">Cloud Sophia</h2>
      <p className="text-sm leading-relaxed text-white/65">
        This is off until you check it. The hosted model is a separate choice from your
        password. Private messages stay on this device: there is no per-thread or per-send
        authorization to upload them, and this screen does not decrypt chat.
      </p>
      <blockquote className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-relaxed text-white/80">
        {CLOUD_SOPHIA_PURPOSE}
      </blockquote>
      <p className="text-xs text-white/45">
        Version {CLOUD_SOPHIA_CONSENT_VERSION}
        {status?.active && grantedLabel ? ` · granted ${grantedLabel}` : ""}
        {status?.consent?.withdrawnAt
          ? ` · withdrawn ${new Date(status.consent.withdrawnAt).toLocaleString()}`
          : ""}
      </p>
      {status?.active ? (
        <div className="space-y-4">
          <p className="text-sm text-white/65">
            Connected mail, calendar, GitHub, and Linear metadata you already linked can be
            included with a question you type here. Full mail bodies and private messages are not.
          </p>
          <button
            type="button"
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-40"
            disabled={busy}
            onClick={() => void withdraw()}
          >
            Withdraw cloud Sophia consent
          </button>
          <form className="space-y-3" onSubmit={(event) => void ask(event)}>
            <label className="block text-sm text-white/70" htmlFor="cloud-sophia-prompt">
              Ask cloud Sophia
            </label>
            <textarea
              id="cloud-sophia-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={2000}
              rows={4}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none"
              placeholder="A question for the hosted model. Chat messages are not attached."
            />
            <button
              type="submit"
              className="rounded-full bg-white px-4 py-2 text-sm text-black disabled:opacity-40"
              disabled={busy || prompt.trim().length === 0}
            >
              {busy ? "Sending…" : "Send question"}
            </button>
          </form>
          {reply ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/80">{reply}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-white/55">
            Leave this unchecked and Sophia stays on this device. Nothing from your account is
            sent to a hosted model.
          </p>
          <label className="flex items-start gap-3 text-sm text-white/75">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
              className="mt-1 accent-white"
            />
            I agree to this purpose for cloud Sophia. You can withdraw it here later.
          </label>
          <button
            type="button"
            className="rounded-full bg-white px-4 py-2 text-sm text-black disabled:opacity-40"
            disabled={!checked || busy}
            onClick={() => void grant()}
          >
            Save cloud Sophia consent
          </button>
        </div>
      )}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}

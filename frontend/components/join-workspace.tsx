"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n } from "@/lib/i18n/locale";
import { inviteCodeFromInput } from "@/lib/workspaces/invite-code";

export function JoinWorkspace() {
  const params = useSearchParams();
  const { t } = useI18n();
  const initial = params.get("code") ?? "";
  const [raw, setRaw] = useState(initial);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const code = inviteCodeFromInput(initial);
    if (!code) return;
    let cancel = false;
    setBusy(true);
    api.previewWorkspaceInvite(code).then((result) => {
      if (!cancel) setName(result.workspace.name);
    }).catch(() => {
      if (!cancel) setError(t("join.invalid"));
    }).finally(() => {
      if (!cancel) setBusy(false);
    });
    return () => {
      cancel = true;
    };
  }, [initial, t]);

  async function lookup(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setName(null);
    setJoined(null);
    const code = inviteCodeFromInput(raw);
    if (!code) {
      setError(t("join.invalid"));
      return;
    }
    setBusy(true);
    try {
      const result = await api.previewWorkspaceInvite(code);
      setName(result.workspace.name);
    } catch {
      setError(t("join.invalid"));
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    setError(null);
    const code = inviteCodeFromInput(raw);
    if (!code) {
      setError(t("join.invalid"));
      return;
    }
    setBusy(true);
    try {
      const result = await api.redeemWorkspaceInvite(code);
      setJoined(result.workspace.name);
      setNeedsSignIn(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setNeedsSignIn(true);
        return;
      }
      setError(caught instanceof ApiError ? caught.message : t("join.invalid"));
    } finally {
      setBusy(false);
    }
  }

  const loginHref = `/login?next=${encodeURIComponent(`/join?code=${inviteCodeFromInput(raw) ?? ""}`)}`;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-(--foreground)">{t("join.title")}</h1>
      <p className="text-sm leading-6 text-(--muted)">{t("join.body")}</p>
      <form className="flex flex-col gap-3" onSubmit={(event) => void lookup(event)}>
        <label className="flex flex-col gap-1 text-sm text-(--foreground)">
          {t("join.code")}
          <input
            value={raw}
            dir="ltr"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setRaw(event.target.value)}
            className="min-h-11 rounded-2xl border border-(--line) bg-(--control-bg) px-3 text-base"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-full border border-(--line) px-4 text-sm text-(--foreground) disabled:opacity-50"
        >
          {busy ? t("join.working") : t("join.lookup")}
        </button>
      </form>
      {name ? (
        <p role="status" className="text-sm text-(--foreground)">
          {t("join.preview", { name: `\u2068${name}\u2069` })}
        </p>
      ) : null}
      {joined ? (
        <p role="status" className="text-sm text-(--foreground)">
          {t("join.success", { name: `\u2068${joined}\u2069` })}{" "}
          <Link href="/settings/workspace" className="underline-offset-4 hover:underline">{t("workspace.open")}</Link>
        </p>
      ) : (
        <button
          type="button"
          disabled={busy || !name}
          onClick={() => void redeem()}
          className="min-h-11 rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background) disabled:opacity-50"
        >
          {t("join.redeem")}
        </button>
      )}
      {needsSignIn ? (
        <p className="text-sm">
          <Link href={loginHref} className="underline-offset-4 hover:underline">{t("join.signIn")}</Link>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}{" "}
          {inviteCodeFromInput(raw) ? <LtrIsolate>{inviteCodeFromInput(raw)}</LtrIsolate> : null}
        </p>
      ) : null}
    </main>
  );
}

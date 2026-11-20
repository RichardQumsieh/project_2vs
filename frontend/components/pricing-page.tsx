"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api";
import { LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

const plans: Array<{
  name: MessageKey;
  price: MessageKey;
  body: MessageKey;
  seats: number;
  brief: boolean;
}> = [
  { name: "pricing.freeName", price: "pricing.freePrice", body: "pricing.freeBody", seats: 6, brief: false },
  { name: "pricing.plusName", price: "pricing.plusPrice", body: "pricing.plusBody", seats: 12, brief: false },
  { name: "pricing.teamName", price: "pricing.teamPrice", body: "pricing.teamBody", seats: 50, brief: true },
];

export function PricingPage() {
  const { locale, t } = useI18n();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t("pricing.invalidEmail"));
      return;
    }
    setBusy(true);
    try {
      await api.joinDesignPartnerWaitlist({
        email: email.trim(),
        locale,
        note: note.trim() || undefined,
      });
      setThanks(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("pricing.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <p className="text-xs font-medium text-(--muted)">{t("pricing.noCharge")}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-(--foreground) sm:text-4xl">
          {t("pricing.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-(--muted) sm:text-base">{t("pricing.subtitle")}</p>
      </header>

      <section aria-labelledby="pricing-privacy" className="flex flex-col gap-3">
        <h2 id="pricing-privacy" className="text-lg font-medium text-(--foreground)">{t("pricing.privacyTitle")}</h2>
        <article className="rounded-3xl border border-(--line) bg-(--glass) p-5">
          <h3 className="text-base font-medium text-(--foreground)">{t("pricing.e2eeTitle")}</h3>
          <p className="mt-2 text-sm leading-6 text-(--muted)">{t("pricing.e2eeBody")}</p>
        </article>
        <article className="rounded-3xl border border-(--line) bg-(--glass) p-5">
          <h3 className="text-base font-medium text-(--foreground)">{t("pricing.safetyTitle")}</h3>
          <p className="mt-2 text-sm leading-6 text-(--muted)">{t("pricing.safetyBody")}</p>
        </article>
        <article className="rounded-3xl border border-(--line) bg-(--glass) p-5">
          <h3 className="text-base font-medium text-(--foreground)">{t("pricing.approvalTitle")}</h3>
          <p className="mt-2 text-sm leading-6 text-(--muted)">{t("pricing.approvalBody")}</p>
        </article>
      </section>

      <section aria-labelledby="pricing-plans" className="flex flex-col gap-3">
        <h2 id="pricing-plans" className="text-lg font-medium text-(--foreground)">{t("pricing.plansTitle")}</h2>
        <div className="grid gap-3">
          {plans.map((plan) => (
            <article key={plan.name} className="rounded-3xl border border-(--line) bg-(--glass) p-5">
              <h3 className="text-base font-medium text-(--foreground)">{t(plan.name)}</h3>
              <p className="mt-1 text-sm text-(--foreground)">
                <LtrIsolate>{t(plan.price)}</LtrIsolate>
              </p>
              <p className="mt-1 text-xs text-(--muted)">{t("pricing.seats", { count: plan.seats })}</p>
              <p className="mt-3 text-sm leading-6 text-(--muted)">{t(plan.body)}</p>
              <p className="mt-3 text-xs text-(--muted)">
                {plan.brief ? t("pricing.briefIncluded") : t("pricing.briefExcluded")}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section id="design-partner" aria-labelledby="pricing-partner" className="rounded-3xl border border-(--line) bg-(--glass) p-5">
        <h2 id="pricing-partner" className="text-lg font-medium text-(--foreground)">{t("pricing.partnerTitle")}</h2>
        <p className="mt-2 text-sm leading-6 text-(--muted)">{t("pricing.partnerBody")}</p>
        {thanks ? (
          <p role="status" className="mt-4 text-sm text-(--foreground)">{t("pricing.thanks")}</p>
        ) : (
          <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
            <label className="flex flex-col gap-1 text-sm text-(--foreground)">
              {t("pricing.email")}
              <input
                type="email"
                dir="ltr"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="min-h-11 rounded-2xl border border-(--line) bg-(--control-bg) px-3 text-base"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-(--foreground)">
              {t("pricing.note")}
              <textarea
                value={note}
                maxLength={280}
                onChange={(event) => setNote(event.target.value)}
                className="min-h-24 rounded-2xl border border-(--line) bg-(--control-bg) px-3 py-2 text-base"
              />
            </label>
            {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background) disabled:opacity-50"
            >
              {busy ? t("pricing.working") : t("pricing.submit")}
            </button>
          </form>
        )}
        <p className="mt-4 text-sm">
          <Link href="/signup" className="underline-offset-4 hover:underline">{t("home.signup")}</Link>
        </p>
      </section>
    </main>
  );
}

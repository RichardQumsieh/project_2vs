"use client";

import Link from "next/link";
import { ExperimentalBadge } from "@/components/experimental-badge";
import { SophiaMark } from "@/components/sophia-mark";
import { useI18n } from "@/lib/i18n/locale";
import { useViewerSession } from "@/lib/use-viewer";

const primaryAction =
  "inline-flex h-11 items-center justify-center rounded-full bg-(--foreground) px-5 text-sm font-medium text-(--background) hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)";

export function Homepage() {
  const viewer = useViewerSession();
  const { t } = useI18n();
  const signedIn = Boolean(viewer.data?.user);

  return (
    <main className="home-entry mx-auto flex w-full max-w-3xl flex-col px-4 py-14 sm:px-6 sm:py-20">
      <p className="text-xs font-medium text-(--muted)">
        {t("home.eyebrow")}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SophiaMark large />
        <h1 className="text-4xl font-semibold tracking-[-0.045em] text-(--foreground) sm:text-6xl">
          Sophia
        </h1>
        <ExperimentalBadge />
      </div>
      <p className="mt-5 max-w-xl text-lg leading-7 text-(--foreground) sm:text-xl sm:leading-8">
        {t("home.tagline")}
      </p>
      <p className="mt-3 max-w-xl text-sm leading-6 text-(--muted) sm:text-base">
        {t("home.body")}
      </p>
      <ul className="mt-6 flex flex-col gap-2 text-sm text-(--muted) sm:flex-row sm:gap-6">
        <li>{t("home.e2ee")}</li>
        <li>{t("home.mfa")}</li>
        <li>{t("home.inbox")}</li>
      </ul>
      <section className="mt-8 max-w-xl" aria-labelledby="home-privacy">
        <h2 id="home-privacy" className="text-sm font-medium text-(--foreground)">{t("home.privacyTitle")}</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm leading-6 text-(--muted)">
          <li>{t("home.privacyE2ee")}</li>
          <li>{t("home.privacySafety")}</li>
          <li>{t("home.privacyApproval")}</li>
        </ul>
      </section>
      <div className="mt-8">
        {viewer.isPending ? (
          <p role="status" className="text-sm text-(--muted)">{t("home.checking")}</p>
        ) : signedIn ? (
          <Link href="/inbox" className={primaryAction}>{t("nav.openInbox")}</Link>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <Link href="/signup" className={primaryAction}>{t("home.signup")}</Link>
            <Link href="/pricing" className="text-sm font-medium text-(--foreground) underline-offset-4 hover:underline">
              {t("home.pricing")}
            </Link>
            <Link
              href="/pricing#design-partner"
              className="text-sm text-(--muted) underline-offset-4 hover:text-(--foreground) hover:underline"
            >
              {t("home.designPartner")}
            </Link>
            <Link
              href="/login"
              className="text-sm text-(--muted) underline-offset-4 hover:text-(--foreground) hover:underline"
            >
              {t("nav.login")}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

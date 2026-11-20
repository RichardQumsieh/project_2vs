"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/locale";

export function PayPalCancel() {
  const { t } = useI18n();
  return (
    <section className="flex max-w-xl flex-col gap-4 rounded-3xl border border-(--line) bg-(--glass) p-5">
      <h2 className="text-lg font-medium text-(--foreground)">{t("billing.cancelTitle")}</h2>
      <p className="text-sm leading-6 text-(--muted)">{t("billing.cancelBody")}</p>
      <Link
        href="/billing/upgrade"
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background)"
      >
        {t("billing.back")}
      </Link>
    </section>
  );
}

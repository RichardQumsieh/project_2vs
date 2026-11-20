"use client";

import Link from "next/link";
import { ProductShell } from "@/components/product-shell";
import { useI18n } from "@/lib/i18n/locale";

export default function DevicesSettingsPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("devices.title")} subtitle={t("devices.subtitle")}>
      <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-relaxed text-white/65 sm:p-6">
        <p>{t("devices.p1")}</p>
        <p>{t("devices.p2")}</p>
        <Link href="/inbox" className="inline-flex min-h-11 items-center rounded-full bg-white px-4 py-2 text-sm text-black">
          {t("devices.back")}
        </Link>
      </div>
    </ProductShell>
  );
}

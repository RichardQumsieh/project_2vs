"use client";

import Link from "next/link";
import { ProductShell } from "@/components/product-shell";
import { SophiaRobotPreview } from "@/components/sophia-robot-preview";
import { useI18n } from "@/lib/i18n/locale";

export default function SophiaSettingsPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("sophiaSettings.title")} subtitle={t("sophiaSettings.subtitle")}>
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <SophiaRobotPreview />
        <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
          <h2 className="text-base font-medium text-white">{t("sophiaSettings.controls")}</h2>
          <p className="text-sm leading-relaxed text-white/55">{t("sophiaSettings.p1")}</p>
          <p className="text-sm leading-relaxed text-white/55">{t("sophiaSettings.p2")}</p>
          <p className="text-sm leading-relaxed text-amber-100/80">{t("sophiaSettings.experimental")}</p>
          <ul className="space-y-2 text-sm text-white/70">
            <li>• {t("sophiaSettings.li1")}</li>
            <li>• {t("sophiaSettings.li2")}</li>
            <li>• {t("sophiaSettings.li3")}</li>
          </ul>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link href="/inbox" className="inline-flex min-h-11 items-center rounded-full bg-white px-4 py-2 text-sm text-black">
              {t("sophiaSettings.openInbox")}
            </Link>
            <Link href="/sophia" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 py-2 text-sm text-white/80">
              {t("sophiaSettings.openStudio")}
            </Link>
            <Link href="/settings/privacy" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-4 py-2 text-sm text-white/80">
              {t("sophiaSettings.cloudConsent")}
            </Link>
          </div>
        </section>
      </div>
    </ProductShell>
  );
}

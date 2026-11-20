"use client";

import { CloudSophiaSettings } from "@/components/cloud-sophia-settings";
import { ProductShell } from "@/components/product-shell";
import { useI18n } from "@/lib/i18n/locale";

export default function PrivacySettingsPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("privacy.title")} subtitle={t("privacy.subtitle")}>
      <div className="mb-4 space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-relaxed text-white/65 sm:p-6">
        <p>{t("privacy.p1")}</p>
        <p>{t("privacy.p2")}</p>
        <p>{t("privacy.p3")}</p>
        <p className="text-white/45">{t("privacy.p4")}</p>
      </div>
      <CloudSophiaSettings />
    </ProductShell>
  );
}

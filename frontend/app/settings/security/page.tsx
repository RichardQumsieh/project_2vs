"use client";

import { ProductShell } from "@/components/product-shell";
import { SafetyNumbersSection } from "@/components/safety-numbers-section";
import { useI18n } from "@/lib/i18n/locale";

export default function SecuritySettingsPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("security.title")} subtitle={t("security.subtitle")}>
      <div className="space-y-4">
        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-relaxed text-white/65 sm:p-6">
          <p>{t("security.p1")}</p>
          <p>{t("security.p2")}</p>
          <p>{t("security.p3")}</p>
        </div>
        <SafetyNumbersSection />
      </div>
    </ProductShell>
  );
}

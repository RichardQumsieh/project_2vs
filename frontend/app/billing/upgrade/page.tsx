"use client";

import { ProductShell } from "@/components/product-shell";
import { BillingUpgrade } from "@/components/billing-upgrade";
import { useI18n } from "@/lib/i18n/locale";

export default function BillingUpgradePage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("billing.upgradeTitle")} subtitle={t("billing.upgradeSubtitle")}>
      <BillingUpgrade />
    </ProductShell>
  );
}

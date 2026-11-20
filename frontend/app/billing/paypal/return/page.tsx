"use client";

import { ProductShell } from "@/components/product-shell";
import { PayPalReturn } from "@/components/billing-paypal-return";
import { useI18n } from "@/lib/i18n/locale";

export default function PayPalReturnPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("billing.returnTitle")} subtitle={t("billing.returnSubtitle")}>
      <PayPalReturn />
    </ProductShell>
  );
}

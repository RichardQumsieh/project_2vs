"use client";

import { ProductShell } from "@/components/product-shell";
import { PayPalCancel } from "@/components/billing-paypal-cancel";
import { useI18n } from "@/lib/i18n/locale";

export default function PayPalCancelPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("billing.cancelTitle")} subtitle={t("billing.cancelBody")}>
      <PayPalCancel />
    </ProductShell>
  );
}

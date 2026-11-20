"use client";

import { ActivityLogPanel } from "@/components/activity-log-panel";
import { ProductShell } from "@/components/product-shell";
import { useI18n } from "@/lib/i18n/locale";

export default function ActivitySettingsPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("activity.title")} subtitle={t("activity.subtitle")}>
      <ActivityLogPanel />
    </ProductShell>
  );
}

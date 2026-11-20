"use client";

import { AppearanceStudio } from "@/components/appearance-studio";
import { ProductShell } from "@/components/product-shell";
import type { PanelId } from "@/lib/appearance/engine";
import { useI18n } from "@/lib/i18n/locale";

export function AppearanceSettings({
  hour,
  role,
  topPanel,
}: {
  hour?: number;
  role?: "manager" | "family";
  topPanel?: PanelId;
}) {
  const { t } = useI18n();
  return (
    <ProductShell title={t("appearance.title")} subtitle={t("appearance.subtitle")}>
      <AppearanceStudio hour={hour} role={role} topPanel={topPanel} />
    </ProductShell>
  );
}

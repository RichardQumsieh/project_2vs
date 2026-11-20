"use client";

import { ProductShell } from "@/components/product-shell";
import { WorkspaceAdmin } from "@/components/workspace-admin";
import { useI18n } from "@/lib/i18n/locale";

export default function WorkspaceSettingsPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("workspace.title")} subtitle={t("workspace.subtitle")}>
      <WorkspaceAdmin />
    </ProductShell>
  );
}

"use client";

import { AvatarCreator } from "@/components/avatar/avatar-creator";
import { ProductShell } from "@/components/product-shell";
import { useI18n } from "@/lib/i18n/locale";

export default function AvatarSettingsPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("avatar.pageTitle")} subtitle={t("avatar.pageSubtitle")}>
      <AvatarCreator />
    </ProductShell>
  );
}

"use client";

import { ProductShell } from "@/components/product-shell";
import { ThemeStudio } from "@/components/theme-studio";
import { useI18n } from "@/lib/i18n/locale";

export default function ThemesPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("themes.title")} subtitle={t("themes.subtitle")}>
      <ThemeStudio />
    </ProductShell>
  );
}

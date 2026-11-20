"use client";

import { SettingsPreferences } from "@/components/settings-preferences";
import { ModuleCard, ProductShell } from "@/components/product-shell";
import { adaptiveThemeEnabled } from "@/lib/appearance/flag";
import { useI18n } from "@/lib/i18n/locale";

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("settings.title")} subtitle={t("settings.subtitle")}>
      <SettingsPreferences />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {adaptiveThemeEnabled() ? (
          <ModuleCard
            href="/settings/appearance"
            title={t("appearance.cardTitle")}
            body={t("appearance.cardBody")}
          />
        ) : null}
        <ModuleCard href="/settings/sophia" title={t("settings.sophia.title")} body={t("settings.sophia.body")} />
        <ModuleCard href="/settings/integrations" title={t("settings.integrations.title")} body={t("settings.integrations.body")} />
        <ModuleCard href="/settings/privacy" title={t("settings.privacy.title")} body={t("settings.privacy.body")} />
        <ModuleCard href="/settings/security" title={t("settings.security.title")} body={t("settings.security.body")} />
        <ModuleCard href="/settings/devices" title={t("settings.devices.title")} body={t("settings.devices.body")} />
        <ModuleCard
          href="/settings/workspace"
          title={t("settings.workspace.title")}
          body={t("settings.workspace.body")}
        />
        <ModuleCard
          href="/settings/subscription"
          title={t("settings.plans.title")}
          body={t("settings.plans.body")}
        />
        <ModuleCard href="/sophia" title={t("settings.studio.title")} body={t("settings.studio.body")} />
      </div>
    </ProductShell>
  );
}

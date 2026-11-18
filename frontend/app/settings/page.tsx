import { SettingsPreferences } from "@/components/settings-preferences";
import { ModuleCard, ProductShell } from "@/components/product-shell";

export default function SettingsPage() {
  return (
    <ProductShell
      title="Settings"
      subtitle="Appearance, encrypted backup, privacy, activity, Sophia, devices, and future subscription tiers."
    >
      <SettingsPreferences />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ModuleCard
          href="/settings/sophia"
          title="Sophia"
          body="Voice presence, personal memory, fast commands, and robot presentation."
        />
        <ModuleCard
          href="/settings/integrations"
          title="Integrations"
          body="Connect mail and calendar. Reconnect after adding send scopes in Google Cloud and Azure."
        />
        <ModuleCard
          href="/settings/privacy"
          title="Privacy"
          body="Cloud Sophia consent, what stays on-device, and how to withdraw."
        />
        <ModuleCard
          href="/settings/activity"
          title="Activity"
          body="Sign-ins, consent, settings changes, and approved mail or calendar actions you can export or delete."
        />
        <ModuleCard
          href="/settings/security"
          title="Security"
          body="Trusted browsers, recovery codes, sessions, and vault unlock behavior."
        />
        <ModuleCard
          href="/settings/devices"
          title="Devices"
          body="Active messaging devices and archive recovery posture."
        />
        <ModuleCard
          href="/settings/subscription"
          title="Plans & billing"
          body="Audience tiers for future subscriptions without changing E2EE defaults."
          badge="Soon"
        />
        <ModuleCard
          href="/sophia"
          title="Sophia studio"
          body="Robot presence, image prompts, and presentation workflow tips."
        />
      </div>
    </ProductShell>
  );
}

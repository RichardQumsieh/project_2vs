import { ModuleCard, ProductShell } from "@/components/product-shell";

export default function SettingsPage() {
  return (
    <ProductShell
      title="Settings"
      subtitle="Production controls for privacy, Jarvis, devices, and future subscription tiers."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ModuleCard
          href="/settings/jarvis"
          title="Jarvis"
          body="Voice presence, personal memory, fast commands, and robot presentation."
        />
        <ModuleCard
          href="/settings/privacy"
          title="Privacy"
          body="What stays on-device, research disclosures, and memory retention."
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
          href="/jarvis"
          title="Jarvis studio"
          body="Robot presence, image prompts, and presentation workflow tips."
        />
      </div>
    </ProductShell>
  );
}

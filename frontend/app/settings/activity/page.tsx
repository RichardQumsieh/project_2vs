import { ActivityLogPanel } from "@/components/activity-log-panel";
import { ProductShell } from "@/components/product-shell";

export default function ActivitySettingsPage() {
  return (
    <ProductShell
      title="Activity"
      subtitle="A log of your account: who did what, and when. Export it or delete the whole log."
    >
      <ActivityLogPanel />
    </ProductShell>
  );
}

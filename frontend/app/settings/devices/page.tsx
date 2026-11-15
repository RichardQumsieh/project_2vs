import Link from "next/link";
import { ProductShell } from "@/components/product-shell";

export default function DevicesSettingsPage() {
  return (
    <ProductShell
      title="Devices"
      subtitle="Messaging devices, archive recovery, and local unlock posture."
    >
      <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-relaxed text-white/65 sm:p-6">
        <p>
          Each browser creates its own device identity and Double Ratchet sessions. New devices
          recover history through the account archive, not by cloning another device’s live state.
        </p>
        <p>
          Manage live chats and encrypted backups from the inbox. This module is the production
          landing surface for device inventories and revoke flows.
        </p>
        <Link href="/inbox" className="inline-flex rounded-full bg-white px-4 py-2 text-sm text-black">
          Back to inbox
        </Link>
      </div>
    </ProductShell>
  );
}

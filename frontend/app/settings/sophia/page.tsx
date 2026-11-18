import Link from "next/link";
import { ProductShell } from "@/components/product-shell";
import { SophiaRobotPreview } from "@/components/sophia-robot-preview";

export default function SophiaSettingsPage() {
  return (
    <ProductShell
      title="Sophia settings"
      subtitle="Configure the speaking robot presence and permissioned command surface."
    >
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <SophiaRobotPreview />
        <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
          <h2 className="text-base font-medium text-white">Chat controls</h2>
          <p className="text-sm leading-relaxed text-white/55">
            Live toggles for Fast Sophia commands, personal memory, voice output, and
            automatic research still live in the conversation header so they stay tied to
            the active thread. Use this page for product orientation and studio assets.
          </p>
          <p className="text-sm leading-relaxed text-white/55">
            Cloud Sophia is a separate consent under Privacy. It stays off until you check it.
            The hosted model does not receive decrypted private messages. Withdraw there to
            stop cloud calls. Your account activity log is under Settings → Activity.
          </p>
          <ul className="space-y-2 text-sm text-white/70">
            <li>• Presentations download as real <strong className="font-medium text-white">.pptx</strong> decks.</li>
            <li>• Compound voice commands stage approvals before any download, search, or draft.</li>
            <li>• Personal notes stay in this browser after approval.</li>
          </ul>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link
              href="/inbox"
              className="rounded-full bg-white px-4 py-2 text-sm text-black"
            >
              Open inbox
            </Link>
            <Link
              href="/sophia"
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80"
            >
              Open Sophia studio
            </Link>
            <Link
              href="/settings/privacy"
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80"
            >
              Cloud consent
            </Link>
          </div>
        </section>
      </div>
    </ProductShell>
  );
}

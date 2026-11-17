import { ProductShell } from "@/components/product-shell";

export default function PrivacySettingsPage() {
  return (
    <ProductShell
      title="Privacy"
      subtitle="Defaults that keep decrypted chat, Sophia prompts, and personal notes on this device."
    >
      <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-relaxed text-white/65 sm:p-6">
        <p>
          Message plaintext, companion dialogue, and personal memory never leave this browser for
          AI inference. Optional automatic research sends only a standalone question through the
          app backend to Brave Search after you opt in.
        </p>
        <p>
          Document downloads (including PPTX) are generated locally. Approvals are required before
          Sophia opens search, stores a note, fills the composer, or downloads a file.
        </p>
        <p>
          Calendar OAuth (Settings → Integrations) stores encrypted refresh tokens and
          owner-scoped event title/time mirrors only. Connecting a calendar does not
          authorize Sophia to use those events for AI; that requires a separate explicit
          consent later. Chat E2EE is unchanged.
        </p>
        <p className="text-white/45">
          Future audience analytics and subscription metrics will stay aggregated and
          non-message-bearing; this page is the home for those disclosures as they ship.
        </p>
      </div>
    </ProductShell>
  );
}

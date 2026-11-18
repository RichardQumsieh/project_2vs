import { CloudSophiaSettings } from "@/components/cloud-sophia-settings";
import { ProductShell } from "@/components/product-shell";

export default function PrivacySettingsPage() {
  return (
    <ProductShell
      title="Privacy"
      subtitle="Cloud Sophia is off until you agree. Private messages stay on this device."
    >
      <div className="mb-4 space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-relaxed text-white/65 sm:p-6">
        <p>
          Private messages stay end-to-end encrypted. This version does not send decrypted
          private-message text to a hosted model. There is no per-thread or per-send
          authorization for that, so Sophia does not decrypt chat in order to call the cloud.
        </p>
        <p>
          Companion dialogue and personal notes stay in this browser. Optional automatic
          research still sends only a standalone question through the app backend to Brave
          Search after you opt in. Document downloads are generated locally.
        </p>
        <p>
          Connecting mail, calendar, GitHub, or Linear does not by itself let Sophia read
          that data for a model. Cloud consent is a separate checkbox. While it is on, a
          cloud question can include metadata from those connections you already linked:
          calendar title and time, mail subject, sender, and a short preview, and GitHub or
          Linear title and state. Full mail bodies are not fetched for the model. Tokens
          are not sent. Withdraw clears the grant and stops those calls.
        </p>
        <p className="text-white/45">
          Settings → Activity lists the events this slice actually records. It is not a log
          of every button.
        </p>
      </div>
      <CloudSophiaSettings />
    </ProductShell>
  );
}

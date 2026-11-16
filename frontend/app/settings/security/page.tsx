import { ProductShell } from "@/components/product-shell";

export default function SecuritySettingsPage() {
  return (
    <ProductShell
      title="Security"
      subtitle="Account factors, trusted browsers, and vault unlock behavior."
    >
      <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5 text-sm leading-relaxed text-white/65 sm:p-6">
        <p>
          Sign-in uses password plus authenticator TOTP (or a recovery code). Trusted browsers can
          skip the challenge for 30 days; password reset revokes them.
        </p>
        <p>
          The history recovery code unlocks archived messages after a password reset. Store it
          offline. Device vault keys remain wrapped locally.
        </p>
        <p className="text-white/45">
          Production subscribers will eventually manage session inventories and forced
          re-authentication policies from this module.
        </p>
      </div>
    </ProductShell>
  );
}

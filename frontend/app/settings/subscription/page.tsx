import { ProductShell } from "@/components/product-shell";

const tiers = [
  {
    name: "Private",
    price: "Included",
    body: "E2EE messaging, local Jarvis commands, personal memory, and PPTX drafts on this device.",
    current: true,
  },
  {
    name: "Studio",
    price: "Coming soon",
    body: "Higher research allowance, richer robot skins, and shared team prompt libraries — still with per-action approval.",
  },
  {
    name: "Organization",
    price: "Coming soon",
    body: "Admin policies, seat billing, and audited allowlists for future workplace deployments.",
  },
];

export default function SubscriptionPage() {
  return (
    <ProductShell
      title="Plans & billing"
      subtitle="Audience-ready subscription scaffolding. Messaging encryption defaults do not change by plan."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {tiers.map((tier) => (
          <article
            key={tier.name}
            className={`rounded-3xl border p-5 sm:p-6 ${
              tier.current
                ? "border-cyan-300/30 bg-cyan-300/[0.06]"
                : "border-white/10 bg-white/[0.035]"
            }`}
          >
            <p className="text-[10px] tracking-[0.18em] text-white/45 uppercase">
              {tier.current ? "Current" : "Future"}
            </p>
            <h2 className="mt-2 text-xl font-medium text-white">{tier.name}</h2>
            <p className="mt-1 text-sm text-cyan-100/80">{tier.price}</p>
            <p className="mt-3 text-sm leading-relaxed text-white/55">{tier.body}</p>
          </article>
        ))}
      </div>
    </ProductShell>
  );
}

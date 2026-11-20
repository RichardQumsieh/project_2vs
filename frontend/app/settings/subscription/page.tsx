"use client";

import { ProductShell } from "@/components/product-shell";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

const tiers: Array<{
  name: MessageKey;
  price: MessageKey;
  body: MessageKey;
  current?: boolean;
}> = [
  {
    name: "plans.personal",
    price: "plans.included",
    body: "plans.personalBody",
    current: true,
  },
  {
    name: "plans.studio",
    price: "plans.coming",
    body: "plans.studioBody",
  },
  {
    name: "plans.org",
    price: "plans.coming",
    body: "plans.orgBody",
  },
];

export default function SubscriptionPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("plans.title")} subtitle={t("plans.subtitle")}>
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
            <p className="text-[10px] text-white/45">
              {tier.current ? t("plans.current") : t("plans.future")}
            </p>
            <h2 className="mt-2 text-lg font-medium text-white">{t(tier.name)}</h2>
            <p className="mt-1 text-sm text-cyan-100/80">{t(tier.price)}</p>
            <p className="mt-3 text-sm leading-relaxed text-white/60">{t(tier.body)}</p>
          </article>
        ))}
      </div>
    </ProductShell>
  );
}

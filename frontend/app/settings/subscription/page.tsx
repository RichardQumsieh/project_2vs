"use client";

import Link from "next/link";
import { ProductShell } from "@/components/product-shell";
import { LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

const tiers: Array<{ name: MessageKey; price: MessageKey; body: MessageKey; brief: boolean }> = [
  { name: "pricing.freeName", price: "pricing.freePrice", body: "pricing.freeBody", brief: false },
  { name: "pricing.plusName", price: "pricing.plusPrice", body: "pricing.plusBody", brief: false },
  { name: "pricing.teamName", price: "pricing.teamPrice", body: "pricing.teamBody", brief: true },
];

export default function SubscriptionPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("plans.title")} subtitle={t("pricing.subtitle")}>
      <div className="grid gap-4">
        {tiers.map((tier) => (
          <article key={tier.name} className="rounded-3xl border border-(--line) bg-(--glass) p-5">
            <h2 className="text-lg font-medium text-(--foreground)">{t(tier.name)}</h2>
            <p className="mt-1 text-sm text-(--foreground)"><LtrIsolate>{t(tier.price)}</LtrIsolate></p>
            <p className="mt-3 text-sm leading-6 text-(--muted)">{t(tier.body)}</p>
            <p className="mt-2 text-xs text-(--muted)">
              {tier.brief ? t("pricing.briefIncluded") : t("pricing.briefExcluded")}
            </p>
          </article>
        ))}
      </div>
      <p className="mt-4 text-sm text-(--muted)">{t("pricing.noCharge")}</p>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <Link href="/settings/workspace" className="underline-offset-4 hover:underline">{t("settings.workspace.title")}</Link>
        <Link href="/pricing#design-partner" className="underline-offset-4 hover:underline">{t("home.designPartner")}</Link>
      </div>
    </ProductShell>
  );
}

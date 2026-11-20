"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api } from "@/lib/api";
import { phaseFromConfirm, readPayPalReturn, type PayPalReturnPhase } from "@/lib/billing/paypal-return";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

const planKey: Record<string, MessageKey> = {
  FREE_FAMILY: "billing.planFree",
  FAMILY_PLUS: "billing.planPlus",
  TEAM: "billing.planTeam",
};

export function PayPalReturn() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<PayPalReturnPhase>("checking");
  const [plan, setPlan] = useState<string>("");

  useEffect(() => {
    const parsed = readPayPalReturn(window.location.search);
    if (!parsed) {
      setPhase("missing");
      return;
    }
    let cancel = false;
    api.confirmPayPalCheckout(parsed.workspaceId, parsed.subscriptionId).then((result) => {
      if (cancel) return;
      setPhase(phaseFromConfirm(result));
      const key = result.planId ? planKey[result.planId] : undefined;
      setPlan(key ? t(key) : "");
    }).catch((caught) => {
      if (cancel) return;
      if (caught instanceof ApiError && caught.status === 401) {
        setPhase("failed");
        return;
      }
      setPhase("failed");
    });
    return () => {
      cancel = true;
    };
  }, [t]);

  const body: Record<PayPalReturnPhase, string> = {
    checking: t("billing.returnChecking"),
    active: t("billing.returnActive", { plan }),
    pending: t("billing.returnPending"),
    canceled: t("billing.returnCanceled"),
    suspended: t("billing.returnSuspended"),
    pastDue: t("billing.returnPastDue"),
    failed: t("billing.returnFailed"),
    missing: t("billing.returnMissing"),
  };

  return (
    <section className="flex max-w-xl flex-col gap-4 rounded-3xl border border-(--line) bg-(--glass) p-5" aria-live="polite">
      <h2 className="text-lg font-medium text-(--foreground)">{t("billing.returnTitle")}</h2>
      <p className="text-sm leading-6 text-(--foreground)">{body[phase]}</p>
      <p className="text-sm leading-6 text-(--muted)">{t("billing.returnNote")}</p>
      <Link
        href="/billing/upgrade"
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-(--line) px-4 text-sm text-(--foreground)"
      >
        {t("billing.back")}
      </Link>
    </section>
  );
}

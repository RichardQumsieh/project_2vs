"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, api, type WorkspaceSummary } from "@/lib/api";
import { isBillingCheckoutUrl } from "@/lib/billing/paypal-return";
import { BidiText, LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

function actionLabel(provider: string, team: boolean, t: (key: MessageKey) => string) {
  if (provider === "paypal") return team ? t("billing.teamAction") : t("billing.familyPlusAction");
  if (provider === "stripe") return t("billing.checkoutAction");
  return t("billing.mockAction");
}

const planKey: Record<string, MessageKey> = {
  FREE_FAMILY: "billing.planFree",
  FAMILY_PLUS: "billing.planPlus",
  TEAM: "billing.planTeam",
};

export function BillingUpgrade() {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seats, setSeats] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? null;
  const owned = workspaces.filter((workspace) => workspace.role === "OWNER");

  useEffect(() => {
    let cancel = false;
    api.listWorkspaces().then((page) => {
      if (cancel) return;
      setWorkspaces(page.workspaces);
      const owner = page.workspaces.find((workspace) => workspace.role === "OWNER");
      setSelectedId(owner?.id ?? page.workspaces[0]?.id ?? null);
      setSeats(Math.max(1, owner?.seatCount ?? page.workspaces[0]?.seatCount ?? 1));
    }).catch((caught) => {
      if (cancel) return;
      if (caught instanceof ApiError && caught.status === 401) {
        setSignedOut(true);
        return;
      }
      setError(caught instanceof ApiError ? caught.message : t("workspace.loadFailed"));
    }).finally(() => {
      if (!cancel) setLoaded(true);
    });
    return () => {
      cancel = true;
    };
  }, [t]);

  async function upgrade(planId: "FAMILY_PLUS" | "TEAM") {
    if (!selected) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await api.checkoutWorkspace(selected.id, {
        planId,
        seatQuantity: planId === "TEAM" ? Math.min(50, Math.max(1, Math.floor(seats) || 1)) : undefined,
      });
      if (result.checkoutUrl) {
        if (!isBillingCheckoutUrl(result.checkoutUrl, selected.billingProvider)) {
          setError(t("billing.failed"));
          return;
        }
        setNotice(t("billing.redirecting"));
        window.location.assign(result.checkoutUrl);
        return;
      }
      setNotice(result.status === "active" ? t("billing.activeNow") : t("billing.paypalNote"));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("billing.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (signedOut) {
    return (
      <p className="text-sm text-(--muted)">
        <Link href="/login" className="underline-offset-4 hover:underline">{t("billing.signIn")}</Link>
      </p>
    );
  }

  if (!loaded) {
    return <p className="text-sm text-(--muted)">{t("billing.loading")}</p>;
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm leading-6 text-(--muted)">{t("billing.encryptionNote")}</p>
      {owned.length === 0 ? <p className="text-sm text-(--muted)">{workspaces.length === 0 ? t("billing.noWorkspace") : t("billing.ownerOnly")}</p> : null}
      {owned.length > 1 ? (
        <div className="flex flex-col gap-2">
          {owned.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              aria-pressed={workspace.id === selectedId}
              onClick={() => {
                setSelectedId(workspace.id);
                setSeats(Math.max(1, workspace.seatCount));
              }}
              className={`min-h-11 rounded-2xl border px-4 text-start text-sm ${
                workspace.id === selectedId
                  ? "border-(--foreground) text-(--foreground)"
                  : "border-(--line) text-(--muted)"
              }`}
            >
              <BidiText>{workspace.name}</BidiText>
            </button>
          ))}
        </div>
      ) : null}
      {selected && selected.role === "OWNER" ? (
        <section className="flex flex-col gap-4 rounded-3xl border border-(--line) bg-(--glass) p-4 sm:p-5">
          <div>
            <p className="text-xs text-(--muted)">{t("billing.currentPlan")}</p>
            <h2 className="mt-1 text-lg font-medium text-(--foreground)">{t(planKey[selected.planId] ?? "billing.planFree")}</h2>
            <p className="mt-1 text-sm text-(--muted)"><BidiText>{selected.name}</BidiText></p>
          </div>
          {selected.billingEnabled && selected.billingProvider !== "off" ? (
            selected.kind === "TEAM" ? (
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-medium text-(--foreground)">{t("billing.planTeam")}</h3>
                <p className="text-sm text-(--foreground)"><LtrIsolate>{t("pricing.teamPrice")}</LtrIsolate></p>
                <p className="text-sm leading-6 text-(--muted)">{t("billing.seatHint")}</p>
                <label className="flex flex-col gap-1 text-sm text-(--foreground)">
                  {t("billing.seatsLabel")}
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={seats}
                    onChange={(event) => setSeats(Number(event.target.value))}
                    className="min-h-11 rounded-2xl border border-(--line) bg-(--control-bg) px-3 text-base"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void upgrade("TEAM")}
                  className="min-h-11 rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background) disabled:opacity-50"
                >
                  {busy ? t("billing.working") : actionLabel(selected.billingProvider, true, t)}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-medium text-(--foreground)">{t("billing.planPlus")}</h3>
                <p className="text-sm text-(--foreground)"><LtrIsolate>{t("pricing.plusPrice")}</LtrIsolate></p>
                <p className="text-sm leading-6 text-(--muted)">{t("pricing.plusBody")}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void upgrade("FAMILY_PLUS")}
                  className="min-h-11 rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background) disabled:opacity-50"
                >
                  {busy ? t("billing.working") : actionLabel(selected.billingProvider, false, t)}
                </button>
              </div>
            )
          ) : (
            <p className="text-sm leading-6 text-(--muted)">{t("billing.billingOff")}</p>
          )}
          {selected.billingProvider === "paypal" ? (
            <p className="text-sm leading-6 text-(--muted)">{t("billing.paypalNote")}</p>
          ) : null}
        </section>
      ) : null}
      {notice ? <p role="status" className="text-sm text-(--foreground)">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}

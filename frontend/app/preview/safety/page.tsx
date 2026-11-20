"use client";

import { useState } from "react";
import { ProductShell } from "@/components/product-shell";
import { SafetyNumbersPanel } from "@/components/safety-numbers-panel";
import type { SafetyCard } from "@/lib/crypto/safety-view";
import { useI18n } from "@/lib/i18n/locale";
import { safetyNumbersEnabled } from "@/lib/safety-numbers-flag";

const directGroups = ["48291", "00331", "77520", "11804", "66019", "29485", "51002", "88341", "00912", "44770", "12658", "93004"];
const groupGroups = ["11028", "44190", "77261", "30558", "91824", "66013", "22940", "85177", "03416", "59002", "71883", "24651"];

export default function SafetyPreviewPage() {
  const { t } = useI18n();
  const enabled = safetyNumbersEnabled();
  return (
    <ProductShell title={t("safety.title")} subtitle={t("safety.intro")}>
      {enabled ? <SafetyPreview /> : (
        <section className="rounded-3xl border border-(--line) bg-(--glass) p-5 sm:p-6">
          <h2 className="text-lg font-medium text-(--foreground)">{t("safety.offTitle")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-(--muted)">{t("safety.offBody")}</p>
        </section>
      )}
    </ProductShell>
  );
}

function SafetyPreview() {
  const { t } = useI18n();
  const cards = previewCards(t("safety.samplePeer"), t("safety.sampleGroup"));
  const [overrides, setOverrides] = useState<Record<string, Pick<SafetyCard, "status" | "canVerify" | "canAccept">>>({});
  const [selectedId, setSelectedId] = useState("preview-direct");
  const [notice, setNotice] = useState<"verified" | "accepted" | null>(null);
  const items = cards.map((item) => {
    const override = overrides[item.id];
    if (!override) return item;
    return {
      ...item,
      ...override,
      members: item.members.map((member) => ({ ...member, changed: override.status === "key_changed" && member.changed })),
    };
  });

  function update(id: string, action: "verify" | "accept") {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    if (action === "verify" && !current.canVerify) return;
    if (action === "accept" && !current.canAccept) return;
    setOverrides((existing) => ({
      ...existing,
      [id]: {
        status: action === "verify" ? "verified" : "unverified",
        canVerify: action !== "verify",
        canAccept: false,
      },
    }));
    setNotice(action === "verify" ? "verified" : "accepted");
  }

  return (
    <section aria-labelledby="safety-preview-title" className="min-w-0 rounded-3xl border border-(--line) bg-(--glass) p-5 sm:p-6">
      <h2 id="safety-preview-title" className="text-lg font-medium text-(--foreground)">{t("safety.title")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-(--muted)">{t("safety.limit")}</p>
      <div className="mt-4">
        <SafetyNumbersPanel
          items={items}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setNotice(null);
          }}
          onVerify={(id) => update(id, "verify")}
          onAccept={(id) => update(id, "accept")}
          localWarning={null}
          showLockedNote={false}
          notice={notice}
        />
      </div>
    </section>
  );
}

function previewCards(peerName: string, groupName: string): SafetyCard[] {
  return [
    {
      id: "preview-direct",
      kind: "direct",
      title: peerName,
      username: "sara",
      status: "key_changed",
      groups: directGroups,
      qrPayload: `sophia-safety-number/v1:${directGroups.join("")}`,
      digits: directGroups.join(""),
      fingerprints: null,
      canVerify: true,
      canAccept: true,
      members: [
        {
          userId: "11111111-1111-4111-8111-111111111111",
          name: "Ada",
          username: "ada",
          you: true,
          deviceCount: 1,
          deviceNames: ["phone"],
          changed: false,
        },
        {
          userId: "22222222-2222-4222-8222-222222222222",
          name: peerName,
          username: "sara",
          you: false,
          deviceCount: 2,
          deviceNames: ["phone", "laptop"],
          changed: true,
        },
      ],
    },
    {
      id: "preview-group",
      kind: "group",
      title: groupName,
      username: null,
      status: "unverified",
      groups: groupGroups,
      qrPayload: `sophia-safety-number/v1:${groupGroups.join("")}`,
      digits: groupGroups.join(""),
      fingerprints: null,
      canVerify: true,
      canAccept: false,
      members: [
        {
          userId: "11111111-1111-4111-8111-111111111111",
          name: "Ada",
          username: "ada",
          you: true,
          deviceCount: 1,
          deviceNames: ["phone"],
          changed: false,
        },
        {
          userId: "22222222-2222-4222-8222-222222222222",
          name: peerName,
          username: "sara",
          you: false,
          deviceCount: 1,
          deviceNames: ["phone"],
          changed: false,
        },
      ],
    },
  ];
}

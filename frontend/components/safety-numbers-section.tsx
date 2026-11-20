"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SafetyNumbersPanel } from "@/components/safety-numbers-panel";
import { ApiError, api } from "@/lib/api";
import { readSafetyStore, writeSafetyStore } from "@/lib/crypto/safety-store";
import { buildSafetyView, reviewSafetyCard, type SafetyView } from "@/lib/crypto/safety-view";
import { useI18n } from "@/lib/i18n/locale";
import { safetyNumbersEnabled } from "@/lib/safety-numbers-flag";
import { currentPublicIdentity } from "@/lib/session";
import { useViewerSession } from "@/lib/use-viewer";

export function SafetyNumbersSection() {
  if (!safetyNumbersEnabled()) return null;
  return <SafetyNumbersLoader />;
}

function SafetyNumbersLoader() {
  const { t } = useI18n();
  const viewer = useViewerSession();
  const userId = viewer.data?.user.id ?? null;
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<"verified" | "accepted" | null>(null);

  const query = useQuery({
    queryKey: ["safety-numbers", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<{ view: SafetyView; capped: boolean }> => {
      if (!userId) throw new Error("Missing account");
      const { conversations } = await api.conversations();
      const directories = [];
      for (const conversation of conversations.slice(0, 20)) {
        try {
          directories.push(await api.identityKeys(conversation.id));
        } catch (error) {
          if (error instanceof ApiError && (error.status === 503 || error.code === "safety_numbers_disabled")) throw error;
          if (error instanceof ApiError && (error.status === 404 || error.status === 403)) continue;
          throw error;
        }
      }
      const store = readSafetyStore(userId);
      const identity = currentPublicIdentity();
      const view = await buildSafetyView({
        viewerUserId: userId,
        local: identity,
        directories,
        store,
        now: new Date().toISOString(),
      });
      if (view.store !== store) writeSafetyStore(userId, view.store);
      return { view, capped: conversations.length > 20 };
    },
  });

  const cards = query.data?.view.cards ?? [];
  const selected = cards.find((card) => card.id === selectedId)
    ?? cards.find((card) => card.status === "key_changed")
    ?? cards[0]
    ?? null;

  async function review(action: "verify" | "accept") {
    if (!query.data || !userId || !selected) return;
    const next = await reviewSafetyCard(
      query.data.view,
      selected.id,
      action,
      new Date().toISOString(),
      query.data.view.local,
      userId,
    );
    if (next === query.data.view) return;
    writeSafetyStore(userId, next.store);
    queryClient.setQueryData(["safety-numbers", userId], {
      view: next,
      capped: query.data.capped,
    });
    setNotice(action === "verify" ? "verified" : "accepted");
  }

  let body;
  if (viewer.isPending || (userId && query.isPending)) {
    body = <p className="text-sm text-(--muted)">{t("safety.loading")}</p>;
  } else if (!userId || (query.error instanceof ApiError && query.error.status === 401)) {
    body = <p className="text-sm text-(--muted)">{t("safety.signIn")}</p>;
  } else if (
    query.error instanceof ApiError
    && (query.error.status === 503 || query.error.code === "safety_numbers_disabled")
  ) {
    body = <p className="text-sm text-(--muted)">{t("safety.serverOff")}</p>;
  } else if (query.error || viewer.isError) {
    body = <p className="text-sm text-(--muted)">{t("safety.loadFailed")}</p>;
  } else if (cards.length === 0) {
    body = <p className="text-sm text-(--muted)">{t("safety.empty")}</p>;
  } else {
    body = (
      <SafetyNumbersPanel
        items={cards}
        selectedId={selected?.id ?? null}
        onSelect={(id) => {
          setSelectedId(id);
          setNotice(null);
        }}
        onVerify={() => void review("verify")}
        onAccept={() => void review("accept")}
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching && !query.isPending}
        localWarning={query.data?.view.localWarning ?? null}
        showLockedNote={query.data?.view.locked ?? true}
        listCapped={query.data?.capped ?? false}
        notice={notice}
      />
    );
  }

  return (
    <section aria-labelledby="safety-numbers-title" className="min-w-0 rounded-3xl border border-(--line) bg-(--glass) p-5 sm:p-6">
      <h2 id="safety-numbers-title" className="text-lg font-medium text-(--foreground)">{t("safety.title")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-(--muted)">{t("safety.intro")}</p>
      <p className="mt-2 text-sm leading-relaxed text-(--muted)">{t("safety.limit")}</p>
      <div className="mt-4">{body}</div>
    </section>
  );
}

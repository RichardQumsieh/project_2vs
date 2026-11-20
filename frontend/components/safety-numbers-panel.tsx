"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { BidiText, LtrIsolate } from "@/lib/i18n/bidi";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";
import type { SafetyCard } from "@/lib/crypto/safety-view";

const statusKey: Record<SafetyCard["status"], MessageKey> = {
  unverified: "safety.unverified",
  verified: "safety.verified",
  key_changed: "safety.keyChanged",
  incomplete: "safety.incomplete",
};

export function SafetyNumbersPanel({
  items,
  selectedId,
  onSelect,
  onVerify,
  onAccept,
  onRefresh,
  refreshing = false,
  localWarning,
  showLockedNote,
  listCapped = false,
  notice,
}: {
  items: SafetyCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onVerify: (id: string) => void;
  onAccept: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  localWarning: "mismatch" | "missing" | null;
  showLockedNote: boolean;
  listCapped?: boolean;
  notice: "verified" | "accepted" | null;
}) {
  const { t } = useI18n();
  const [copy, setCopy] = useState<{ id: string; state: "copied" | "failed" } | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const copyState = copy && copy.id === selected?.id ? copy.state : "idle";
  const changes = items.filter((item) => item.status === "key_changed").length;

  async function copyNumber() {
    if (!selected?.groups.length) return;
    try {
      await navigator.clipboard.writeText(selected.groups.join(" "));
      setCopy({ id: selected.id, state: "copied" });
    } catch {
      setCopy({ id: selected.id, state: "failed" });
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      {localWarning ? (
        <p role="alert" className="rounded-2xl border border-amber-700/40 bg-amber-500/10 p-4 text-sm leading-relaxed text-(--foreground)">
          {localWarning === "mismatch" ? t("safety.localMismatch") : t("safety.localMissing")}
        </p>
      ) : null}
      {showLockedNote ? <p className="text-sm text-(--muted)">{t("safety.lockedNote")}</p> : null}
      {changes > 0 ? (
        <p role="status" className="text-sm font-medium text-(--foreground)">
          {t("safety.changedCount", { count: changes })}
        </p>
      ) : null}
      {listCapped ? <p className="text-sm text-(--muted)">{t("safety.listCapped")}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-(--foreground)">{t("safety.listLabel")}</h3>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex min-h-11 items-center rounded-full border border-(--line) px-4 text-sm text-(--foreground) hover:bg-(--control-hover) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) disabled:opacity-60"
          >
            {refreshing ? t("safety.refreshing") : t("safety.refresh")}
          </button>
        ) : null}
      </div>
      <ul aria-label={t("safety.listLabel")} className="space-y-2">
        {items.map((item) => {
          const title = item.title?.trim() || t(item.kind === "group" ? "safety.group" : "safety.direct");
          const pressed = item.id === selected?.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => onSelect(item.id)}
                className={`flex w-full min-h-11 min-w-0 items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) ${
                  pressed ? "border-(--accent) bg-(--control-hover)" : "border-(--line) bg-(--control-bg)"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-(--foreground)">
                    <BidiText>{title}</BidiText>
                  </span>
                  <span className="block truncate text-xs text-(--muted)">
                    {item.username ? <LtrIsolate>@{item.username}</LtrIsolate> : t(item.kind === "group" ? "safety.group" : "safety.direct")}
                  </span>
                </span>
                <span className="shrink-0 rounded-full border border-(--line) px-2 py-1 text-xs text-(--foreground)">
                  {t(statusKey[item.status])}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? <SafetyDetail item={selected} notice={notice} copyState={copyState} onCopy={() => void copyNumber()} onVerify={() => onVerify(selected.id)} onAccept={() => onAccept(selected.id)} /> : null}
    </div>
  );
}

function SafetyDetail({
  item,
  notice,
  copyState,
  onCopy,
  onVerify,
  onAccept,
}: {
  item: SafetyCard;
  notice: "verified" | "accepted" | null;
  copyState: "idle" | "copied" | "failed";
  onCopy: () => void;
  onVerify: () => void;
  onAccept: () => void;
}) {
  const { t } = useI18n();
  const title = item.title?.trim() || t(item.kind === "group" ? "safety.group" : "safety.direct");
  return (
    <article className="min-w-0 space-y-4 rounded-2xl border border-(--line) bg-(--control-bg) p-4" aria-label={title}>
      <div className="min-w-0">
        <h3 className="truncate text-base font-medium text-(--foreground)">
          <BidiText>{title}</BidiText>
        </h3>
        <p className="text-xs text-(--muted)">{t(item.kind === "group" ? "safety.group" : "safety.direct")}</p>
      </div>
      {item.status === "key_changed" ? (
        <div role="alert" className="rounded-2xl border border-amber-700/40 bg-amber-500/10 p-4">
          <p className="font-medium text-(--foreground)">{t("safety.warningTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-(--muted)">{t("safety.warningBody")}</p>
        </div>
      ) : null}
      {item.status === "incomplete" || item.groups.length === 0 ? (
        <p className="text-sm leading-relaxed text-(--muted)">{t("safety.truncated")}</p>
      ) : (
        <div>
          <p id={`safety-number-${item.id}`} className="text-xs text-(--muted)">{t("safety.numberLabel")}</p>
          <div
            dir="ltr"
            lang="en"
            aria-labelledby={`safety-number-${item.id}`}
            className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-base text-(--foreground) tabular-nums sm:grid-cols-3"
          >
            {item.groups.map((group, index) => (
              <span key={`${item.id}-${index}`}>{group}</span>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-(--muted)">{t("safety.compareHint")}</p>
          {item.qrPayload ? (
            <div className="mt-4">
              <div className="inline-flex rounded-2xl bg-white p-3" role="img" aria-label={t("safety.qrTitle")}>
                <QRCodeSVG value={item.qrPayload} size={148} level="M" bgColor="#ffffff" fgColor="#111111" />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-(--muted)">{t("safety.qrHint")}</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onCopy}
            className="mt-3 inline-flex min-h-11 items-center rounded-full border border-(--line) px-4 text-sm text-(--foreground) hover:bg-(--control-hover) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
          >
            {copyState === "copied" ? t("safety.copied") : t("safety.copy")}
          </button>
          {copyState === "failed" ? <p className="mt-2 text-xs text-(--muted)">{t("safety.copyFailed")}</p> : null}
        </div>
      )}
      <div>
        <h4 className="text-sm font-medium text-(--foreground)">{t("safety.members")}</h4>
        <ul className="mt-2 space-y-3">
          {item.members.map((member) => (
            <li key={member.userId} className="min-w-0 text-sm">
              <p className="min-w-0 text-(--foreground)">
                <BidiText>{member.name}</BidiText>
                {member.you ? <span className="ms-2 text-xs text-(--muted)">{t("safety.you")}</span> : null}
                {member.changed ? <span className="ms-2 text-xs text-(--foreground)">{t("safety.keyChanged")}</span> : null}
              </p>
              <p className="mt-0.5 text-xs text-(--muted)">
                <LtrIsolate>@{member.username}</LtrIsolate>
                <span className="ms-2">
                  {member.deviceCount === 0 ? t("safety.noDevices") : t("safety.deviceCount", { count: member.deviceCount })}
                </span>
              </p>
              {member.deviceNames.length > 0 ? (
                <p className="mt-0.5 break-words text-xs text-(--muted)" dir="auto">{member.deviceNames.join(" · ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={onVerify}
          disabled={!item.canVerify}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) disabled:opacity-50"
        >
          {t("safety.markVerified")}
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={!item.canAccept}
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-(--line) px-4 text-sm text-(--foreground) hover:bg-(--control-hover) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) disabled:opacity-50"
        >
          {t("safety.acceptChange")}
        </button>
      </div>
      {item.status === "verified" ? <p className="text-sm text-(--muted)">{t("safety.verifiedNote")}</p> : null}
      {notice === "accepted" && item.status === "unverified" ? <p className="text-sm text-(--muted)">{t("safety.acceptNote")}</p> : null}
    </article>
  );
}

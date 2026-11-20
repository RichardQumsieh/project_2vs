"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { ExperimentalBadge } from "@/components/experimental-badge";
import { Button } from "@/components/ui/button";
import type { AgentProposal } from "@/lib/ai/agent-runtime";
import { isJobManagerTool } from "@/lib/ai/sophia-job-tools";
import {
  badgeToneClass,
  outboundPayloadFields,
  providerBadgeForAction,
} from "@/lib/ai/sophia-proposal-ux";
import {
  localizedActionSummary,
  localizedApproveVerb,
  localizedFieldLabel,
  localizedFieldValue,
  localizedProvenance,
  localizedProviderLabel,
} from "@/lib/i18n/action-summary";
import { useI18n } from "@/lib/i18n/locale";

type SophiaProposalCardProps = {
  proposal: AgentProposal;
  onApprove: (proposal: AgentProposal) => void | Promise<void>;
  onCancel: (proposal: AgentProposal) => void;
  busy?: boolean;
};

export function SophiaProposalCard({
  proposal,
  onApprove,
  onCancel,
  busy = false,
}: SophiaProposalCardProps) {
  const reduceMotion = useReducedMotion();
  const { t } = useI18n();
  const [sheetOpen, setSheetOpen] = useState(
    isJobManagerTool(proposal.action.type),
  );
  const badge = providerBadgeForAction(proposal.action);
  const provenance = localizedProvenance(proposal.provenance, t);
  const fields = outboundPayloadFields(proposal.action);
  const jobWrite = isJobManagerTool(proposal.action.type);

  return (
    <motion.article
      initial={
        reduceMotion ? { opacity: 1 } : { opacity: 0, y: 10, scale: 0.985 }
      }
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }
      }
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
      className="space-y-2 rounded-xl border border-amber-200/20 bg-amber-200/[0.04] p-3"
      aria-label={t("approval.region")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ExperimentalBadge />
        <p className="text-[10px] text-amber-100/70">
          {t("approval.required")}
          {jobWrite ? ` · ${t("approval.exact")}` : ""}
        </p>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeToneClass(badge.tone)}`}
        >
          {localizedProviderLabel(badge.id, badge.label, t)}
        </span>
        {provenance ? (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/55">
            {provenance}
          </span>
        ) : null}
      </div>
      <p dir="auto" className="bidi-plaintext text-xs text-white/80">
        {localizedActionSummary(proposal.action, t)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSheetOpen((open) => !open)}
        >
          {sheetOpen ? t("approval.hide") : t("approval.show")}
        </Button>
      </div>
      <AnimatePresence initial={false}>
        {sheetOpen ? (
          <motion.div
            key={`${proposal.id}-sheet`}
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <dl className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-black/35 p-2.5">
              {fields.map((field) => (
                <div key={`${field.label}-${field.value.slice(0, 24)}`}>
                  <dt className="text-[10px] text-white/40">
                    {localizedFieldLabel(field.label, t)}
                  </dt>
                  <dd dir="auto" className="bidi-plaintext mt-0.5 whitespace-pre-wrap break-words text-[11px] text-white/75">
                    {localizedFieldValue(field.label, field.value, t)}
                  </dd>
                </div>
              ))}
            </dl>
            {jobWrite ? (
              <p className="mt-2 text-[10px] leading-relaxed text-white/40">
                {t("approval.nothingSent")}
              </p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void onApprove(proposal)}
        >
          {localizedApproveVerb(proposal.action, t)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onCancel(proposal)}
        >
          {t("approval.cancel")}
        </Button>
      </div>
    </motion.article>
  );
}

type SophiaApproveSuccessProps = {
  message: string | null;
};

export function SophiaApproveSuccess({ message }: SophiaApproveSuccessProps) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {message ? (
        <motion.p
          key={message}
          role="status"
          initial={
            reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8, scale: 0.98 }
          }
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
          className="rounded-xl border border-emerald-300/25 bg-emerald-300/[0.08] px-3 py-2 text-xs text-emerald-50/90"
        >
          {message}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

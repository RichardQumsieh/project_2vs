"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  filterSlashHints,
  SOPHIA_MENTION_CHIPS,
  SOPHIA_SLASH_HINTS,
  type SlashHint,
} from "@/lib/ai/sophia-proposal-ux";

type SophiaCommandHintsProps = {
  input: string;
  onInsert: (text: string) => void;
  disabled?: boolean;
};

export function SophiaCommandHints({
  input,
  onInsert,
  disabled = false,
}: SophiaCommandHintsProps) {
  const reduceMotion = useReducedMotion();
  const slashHints = filterSlashHints(input);
  const showSlashPalette = slashHints.length > 0;
  const showIdleHints = !showSlashPalette && input.trim().length === 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" aria-label="Sophia mention chips">
        {SOPHIA_MENTION_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            disabled={disabled}
            className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-1 text-[11px] font-medium text-cyan-50/85 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 disabled:opacity-40"
            onClick={() => onInsert(chip.insert)}
          >
            {chip.label}
          </button>
        ))}
        {showIdleHints
          ? SOPHIA_SLASH_HINTS.slice(0, 4).map((hint) => (
              <button
                key={hint.id}
                type="button"
                disabled={disabled}
                className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/55 transition hover:border-white/20 hover:text-white/80 disabled:opacity-40"
                onClick={() => onInsert(hint.insert)}
                title={hint.description}
              >
                {hint.label}
              </button>
            ))
          : null}
      </div>
      <AnimatePresence initial={false}>
        {showSlashPalette ? (
          <motion.div
            key="sophia-slash-palette"
            role="listbox"
            aria-label="Sophia slash commands"
            initial={
              reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6, height: 0 }
            }
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={
              reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, height: 0 }
            }
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
            className="overflow-hidden rounded-xl border border-white/10 bg-black/35"
          >
            <ul className="divide-y divide-white/[0.06]">
              {slashHints.map((hint) => (
                <SlashHintRow
                  key={hint.id}
                  hint={hint}
                  disabled={disabled}
                  onInsert={onInsert}
                />
              ))}
            </ul>
            <p className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-white/35">
              Stages a proposal for approval — never sends silently.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SlashHintRow({
  hint,
  disabled,
  onInsert,
}: {
  hint: SlashHint;
  disabled: boolean;
  onInsert: (text: string) => void;
}) {
  return (
    <li role="option">
      <button
        type="button"
        disabled={disabled}
        className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left transition hover:bg-white/[0.04] disabled:opacity-40"
        onClick={() => onInsert(hint.insert)}
      >
        <span className="font-mono text-[11px] text-cyan-100/80">
          {hint.label}
        </span>
        <span className="truncate text-[11px] text-white/45">
          {hint.description}
        </span>
      </button>
    </li>
  );
}

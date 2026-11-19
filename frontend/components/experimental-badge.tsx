"use client";

import { ASSISTANT_EXPERIMENTAL } from "@/lib/ai/assistant-quality";
import { useI18n } from "@/lib/i18n/locale";

export function ExperimentalBadge({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  if (!ASSISTANT_EXPERIMENTAL) return null;
  return (
    <span
      className={`experimental-badge ${className}`.trim()}
      title={t("experimental.hint")}
    >
      {t("experimental.label")}
    </span>
  );
}

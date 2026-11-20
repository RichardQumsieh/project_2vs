"use client";

import { InboxActivityLog } from "@/components/inbox-activity-log";
import { InboxHomeActivity } from "@/components/inbox-activity-panel";
import type { InboxHub } from "@/lib/inbox-hub";
import { useI18n } from "@/lib/i18n/locale";

export function InboxHome({ hub }: { hub: InboxHub }) {
  if (hub === "activity") return <InboxActivityLog />;
  if (hub === "mail") return <InboxHomeActivity />;
  return <InboxChatPlaceholder />;
}

function InboxChatPlaceholder() {
  const { t } = useI18n();
  return (
    <div className="inbox-chat-placeholder text-(--muted)">
      <p className="text-sm font-medium text-(--foreground)">{t("chat.select")}</p>
      <p className="max-w-sm text-sm leading-6">{t("inbox.hub.pickChat")}</p>
    </div>
  );
}

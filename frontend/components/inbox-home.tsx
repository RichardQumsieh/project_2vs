"use client";

import { InboxActivityLog } from "@/components/inbox-activity-log";
import { InboxHomeActivity } from "@/components/inbox-activity-panel";
import { SophiaCommandBar } from "@/components/sophia-command-bar";
import type { InboxHub } from "@/lib/inbox-hub";
import { useI18n } from "@/lib/i18n/locale";

export function InboxHome({ hub }: { hub: InboxHub }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="shrink-0 border-b border-white/10 p-3 min-[960px]:hidden">
        <SophiaCommandBar mode="live" />
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {hub === "activity" ? <InboxActivityLog /> : null}
        {hub === "mail" ? <InboxHomeActivity /> : null}
        {hub === "chats" ? <InboxChatPlaceholder /> : null}
      </div>
    </div>
  );
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

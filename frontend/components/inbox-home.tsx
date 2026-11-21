"use client";

import { InboxActivityLog } from "@/components/inbox-activity-log";
import { InboxHomeActivity } from "@/components/inbox-activity-panel";
import { SophiaCommandBar } from "@/components/sophia-command-bar";
import { WorkspaceAdmin } from "@/components/workspace-admin";
import type { InboxHub } from "@/lib/inbox-hub";
import { useI18n } from "@/lib/i18n/locale";

export function InboxHome({ hub }: { hub: InboxHub }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {hub === "assistant" ? (
          <div className="mx-auto w-full max-w-2xl p-3 sm:p-4">
            <SophiaCommandBar mode="live" layout="chat" />
          </div>
        ) : null}
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
    <div className="min-h-0 overflow-auto p-4 text-(--muted)">
      <p className="text-sm font-medium text-(--foreground)">{t("chat.select")}</p>
      <p className="mt-1 max-w-sm text-sm leading-6">{t("inbox.hub.pickChat")}</p>
      <div className="mt-4">
        <WorkspaceAdmin />
      </div>
    </div>
  );
}

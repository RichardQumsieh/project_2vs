"use client";

import { History, Mail, MessageSquare, Sparkles } from "lucide-react";
import Link from "next/link";
import { groupE2eeEnabled } from "@/lib/group-e2ee-flag";
import { inboxHubHref, type InboxHub } from "@/lib/inbox-hub";
import { useI18n } from "@/lib/i18n/locale";

const hubs: Array<{ id: InboxHub; icon: typeof MessageSquare }> = [
  { id: "chats", icon: MessageSquare },
  { id: "assistant", icon: Sparkles },
  { id: "activity", icon: History },
  { id: "mail", icon: Mail },
];

export function InboxHubNav({
  hub,
  hrefFor = inboxHubHref,
  className,
}: {
  hub: InboxHub;
  hrefFor?: (hub: InboxHub) => string;
  className?: string;
}) {
  const { t } = useI18n();
  const labels: Record<InboxHub, string> = {
    chats: groupE2eeEnabled() ? t("inbox.hub.chatsGroups") : t("inbox.hub.chats"),
    assistant: t("inbox.hub.assistant"),
    activity: t("inbox.hub.activity"),
    mail: t("inbox.hub.mail"),
  };

  return (
    <nav aria-label={t("inbox.hub.nav")} className={className}>
      {hubs.map((item) => {
        const Icon = item.icon;
        const current = hub === item.id;
        return (
          <Link
            key={item.id}
            href={hrefFor(item.id)}
            title={labels[item.id]}
            aria-label={labels[item.id]}
            aria-current={current ? "page" : undefined}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span>{labels[item.id]}</span>
          </Link>
        );
      })}
    </nav>
  );
}

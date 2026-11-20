"use client";

import Link from "next/link";
import { ActivityLogPanel, type ActivityLogSnapshot } from "@/components/activity-log-panel";
import { inboxHubHref } from "@/lib/inbox-hub";
import { useI18n } from "@/lib/i18n/locale";

export function InboxActivityLog({
  initialPage,
  backHref = inboxHubHref("chats"),
}: {
  initialPage?: ActivityLogSnapshot;
  backHref?: string;
}) {
  const { t } = useI18n();

  return (
    <section
      className="inbox-activity-log flex h-full min-h-0 w-full min-w-0 flex-col"
      aria-labelledby="inbox-activity-title"
    >
      <header className="flex min-w-0 items-start gap-2 border-b border-white/10 px-3 py-3 sm:px-5">
        <Link href={backHref} className="inbox-pane-back shrink-0 rounded-full px-3 py-1 text-sm font-medium text-white">
          {t("mail.back")}
        </Link>
        <div className="min-w-0">
          <h2 id="inbox-activity-title" className="text-base font-semibold tracking-tight text-white">
            {t("activity.title")}
          </h2>
          <p className="mt-1 text-sm leading-5 text-white">{t("activity.subtitle")}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
        <ActivityLogPanel initialPage={initialPage} />
      </div>
    </section>
  );
}

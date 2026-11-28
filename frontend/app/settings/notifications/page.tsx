"use client";

import { NotificationSettings } from "@/components/notification-settings";
import { ProductShell } from "@/components/product-shell";
import { useI18n } from "@/lib/i18n/locale";

export default function NotificationsPage() {
  const { t } = useI18n();
  return (
    <ProductShell title={t("notifications.title")} subtitle={t("notifications.subtitle")}>
      <NotificationSettings />
    </ProductShell>
  );
}

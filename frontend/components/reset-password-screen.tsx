"use client";

import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import { useI18n } from "@/lib/i18n/locale";

export function ResetPasswordScreen({ token }: { token: string }) {
  const { t } = useI18n();
  return (
    <AuthPageShell
      eyebrow={t("auth.forgotEyebrow")}
      title={t("auth.resetTitle")}
      description={t("auth.resetBody")}
      footer={
        <Link href="/login" className="font-medium text-(--foreground)">
          {t("auth.returnLogin")}
        </Link>
      }
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-sm text-(--danger)">{t("auth.resetMissing")}</p>
      )}
    </AuthPageShell>
  );
}

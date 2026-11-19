"use client";

import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import { useI18n } from "@/lib/i18n/locale";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  return (
    <AuthPageShell
      eyebrow={t("auth.forgotEyebrow")}
      title={t("auth.forgotTitle")}
      description={t("auth.forgotBody")}
      footer={
        <>
          {t("auth.remembered")}{" "}
          <Link href="/login" className="font-medium text-(--foreground)">{t("auth.loginLink")}</Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}

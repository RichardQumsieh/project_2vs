"use client";

import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import { useI18n } from "@/lib/i18n/locale";

export default function SignupPage() {
  const { t } = useI18n();
  return (
    <AuthPageShell
      footer={
        <>
          {t("auth.already")}{" "}
          <Link href="/login" className="font-medium text-(--foreground)">
            {t("auth.loginLink")}
          </Link>
        </>
      }
    >
      <AuthForm mode="signup" />
    </AuthPageShell>
  );
}

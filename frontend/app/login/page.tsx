"use client";

import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import { useI18n } from "@/lib/i18n/locale";

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <AuthPageShell
      footer={
        <>
          {t("auth.newHere")}{" "}
          <Link href="/signup" className="font-medium text-(--foreground)">
            {t("auth.createAccountLink")}
          </Link>
        </>
      }
    >
      <AuthForm mode="login" />
    </AuthPageShell>
  );
}

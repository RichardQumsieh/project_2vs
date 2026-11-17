import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token)
    ? params.token[0] ?? ""
    : params.token ?? "";

  return (
    <AuthPageShell
      eyebrow="Account recovery"
      title="Choose a new password."
      description={
        <>
          Resetting the password creates a new device vault. Private keys protected by your
          previous password cannot be recovered.
        </>
      }
      footer={
        <Link href="/login" className="font-medium text-(--foreground)">Return to login</Link>
      }
    >
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="text-sm text-(--danger)">This reset link is missing or invalid.</p>
        )}
    </AuthPageShell>
  );
}

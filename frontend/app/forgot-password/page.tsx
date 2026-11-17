import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      eyebrow="Account recovery"
      title="Reset your password."
      description={
        <>
          We will email a one-time reset link. Your authenticator or a recovery code is also
          required to complete the reset.
        </>
      }
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-(--foreground)">Log in</Link>
        </>
      }
    >
        <ForgotPasswordForm />
    </AuthPageShell>
  );
}

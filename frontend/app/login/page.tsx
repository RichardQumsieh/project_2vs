import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import Link from "next/link";

export default function LoginPage() {
  return (
    <AuthPageShell
      eyebrow="Welcome back"
      title="Unlock this device."
      description={
        <>
          Enter your password and authenticator code. Your local vault opens only on this device.
        </>
      }
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="text-white">
            Create an account
          </Link>
        </>
      }
    >
      <AuthForm mode="login" />
    </AuthPageShell>
  );
}

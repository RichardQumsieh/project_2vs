import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import Link from "next/link";

export default function LoginPage() {
  return (
    <AuthPageShell
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="font-medium text-(--foreground)">
            Create an account
          </Link>
        </>
      }
    >
      <AuthForm mode="login" />
    </AuthPageShell>
  );
}

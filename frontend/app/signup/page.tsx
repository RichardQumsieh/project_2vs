import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import Link from "next/link";

export default function SignupPage() {
  return (
    <AuthPageShell
      footer={
        <>
          Already here?{" "}
          <Link href="/login" className="font-medium text-(--foreground)">
            Log in
          </Link>
        </>
      }
    >
      <AuthForm mode="signup" />
    </AuthPageShell>
  );
}

import { AuthForm } from "@/components/auth-form";
import { AuthPageShell } from "@/components/auth-page-shell";
import Link from "next/link";

export default function SignupPage() {
  return (
    <AuthPageShell
      eyebrow="Create account"
      title="Start privately."
      description={
        <>
          Protect your account with authenticator MFA. Keys are generated in the browser; the API
          stores public material and ciphertext only.
        </>
      }
      footer={
        <>
          Already here?{" "}
          <Link href="/login" className="text-white">
            Log in
          </Link>
        </>
      }
    >
      <AuthForm mode="signup" />
    </AuthPageShell>
  );
}

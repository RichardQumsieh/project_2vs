import { ResetPasswordScreen } from "@/components/reset-password-screen";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token)
    ? params.token[0] ?? ""
    : params.token ?? "";

  return <ResetPasswordScreen token={token} />;
}

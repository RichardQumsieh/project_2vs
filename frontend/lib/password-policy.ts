const maxPasswordLength = 128;

export type PasswordRule = {
  id: "length" | "upper" | "lower" | "digit" | "symbol" | "localPart";
  label: string;
  met: boolean;
};

export function emailLocalPart(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "";
  const local = trimmed.slice(0, at);
  if (!local || /\s/.test(local)) return "";
  return local;
}

export function passwordRules(password: string, email?: string): PasswordRule[] {
  const rules: PasswordRule[] = [
    {
      id: "length",
      label: password.length > maxPasswordLength
        ? "Use at most 128 characters."
        : "At least 12 characters.",
      met: password.length >= 12 && password.length <= maxPasswordLength,
    },
    {
      id: "upper",
      label: "One uppercase letter.",
      met: /[A-Z]/.test(password),
    },
    {
      id: "lower",
      label: "One lowercase letter.",
      met: /[a-z]/.test(password),
    },
    {
      id: "digit",
      label: "One digit.",
      met: /\d/.test(password),
    },
    {
      id: "symbol",
      label: "One symbol.",
      met: /[^A-Za-z0-9]/.test(password),
    },
  ];

  if (email !== undefined) {
    const local = emailLocalPart(email);
    rules.push({
      id: "localPart",
      label: "Does not contain your email name.",
      met: password.length > 0 && local.length > 0 && !password.toLowerCase().includes(local),
    });
  }

  return rules;
}

export function passwordPolicyFailure(password: string, email?: string): string | null {
  const unmet = passwordRules(password, email).find((rule) => !rule.met);
  return unmet?.label ?? null;
}

export function passwordIsReady(password: string, passwordConfirm: string, email?: string) {
  return passwordPolicyFailure(password, email) === null && password === passwordConfirm && passwordConfirm.length > 0;
}

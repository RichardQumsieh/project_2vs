import { passwordRules } from "@/lib/password-policy";

export function PasswordRules({
  password,
  email,
  confirmed,
}: {
  password: string;
  email?: string;
  confirmed?: boolean;
}) {
  const rules = passwordRules(password, email);
  const items = confirmed === undefined
    ? rules
    : [
        ...rules,
        {
          id: "match" as const,
          label: "Passwords match.",
          met: password.length > 0 && confirmed,
        },
      ];

  return (
    <ul className="mt-3 space-y-1.5" aria-live="polite">
      {items.map((rule) => (
        <li
          key={rule.id}
          data-met={rule.met ? "true" : "false"}
          className="password-rule"
        >
          <span aria-hidden="true">{rule.met ? "✓" : "○"}</span>
          <span>{rule.label}</span>
          <span className="sr-only">{rule.met ? "Met" : "Unmet"}</span>
        </li>
      ))}
    </ul>
  );
}

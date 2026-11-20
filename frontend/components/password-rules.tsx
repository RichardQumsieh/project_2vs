import { passwordRules } from "@/lib/password-policy";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

const ruleKeys: Record<string, MessageKey> = {
  length: "password.length",
  upper: "password.upper",
  lower: "password.lower",
  digit: "password.digit",
  symbol: "password.symbol",
  localPart: "password.localPart",
  match: "password.match",
};

export function PasswordRules({
  password,
  email,
  confirmed,
}: {
  password: string;
  email?: string;
  confirmed?: boolean;
}) {
  const { t } = useI18n();
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
          <span>
            {rule.id === "length" && rule.label.startsWith("Use at most")
              ? t("password.tooLong")
              : t(ruleKeys[rule.id] ?? "password.length")}
          </span>
          <span className="sr-only">{rule.met ? t("password.met") : t("password.unmet")}</span>
        </li>
      ))}
    </ul>
  );
}

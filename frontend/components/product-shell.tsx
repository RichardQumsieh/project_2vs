"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExperimentalBadge } from "@/components/experimental-badge";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SophiaMark } from "@/components/sophia-mark";
import { useI18n, type MessageKey } from "@/lib/i18n/locale";

const nav: Array<{ href: string; label: MessageKey }> = [
  { href: "/inbox", label: "nav.inbox" },
  { href: "/sophia", label: "nav.sophia" },
  { href: "/settings", label: "nav.settings" },
  { href: "/settings/subscription", label: "nav.plans" },
];

export function ProductShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <div className="app-content relative min-h-dvh px-4 pb-16 pt-6 sm:px-6 lg:px-10">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/inbox"
            className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-white"
          >
            <SophiaMark />
            Sophia
            <ExperimentalBadge />
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 max-w-2xl text-sm text-white/55">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <LanguageSwitcher />
          <nav className="flex max-w-full flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
            {nav.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/inbox" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors sm:text-sm ${
                    active
                      ? "bg-white text-black"
                      : "text-white/65 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {t(item.label)}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto mt-8 w-full max-w-6xl">{children}</main>
    </div>
  );
}

export function ModuleCard({
  href,
  title,
  body,
  badge,
}: {
  href: string;
  title: string;
  body: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-3xl border border-white/10 bg-white/[0.035] p-5 transition-[border-color,background-color,transform] hover:border-cyan-300/25 hover:bg-white/[0.05] sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-medium text-white">{title}</h2>
        {badge ? (
          <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-100/80">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-white/55">{body}</p>
      <ModuleOpen />
    </Link>
  );
}

function ModuleOpen() {
  const { t } = useI18n();
  return (
    <p className="mt-4 text-xs text-cyan-200/70 group-hover:text-cyan-100">
      {t("shell.openModule")}
    </p>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SophiaMark } from "@/components/sophia-mark";

const nav = [
  { href: "/inbox", label: "Inbox" },
  { href: "/sophia", label: "Sophia" },
  { href: "/settings", label: "Settings" },
  { href: "/settings/subscription", label: "Plans" },
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
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 max-w-2xl text-sm text-white/55">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex flex-wrap items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
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
                  {item.label}
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
          <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] tracking-wide text-amber-100/80 uppercase">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-white/55">{body}</p>
      <p className="mt-4 text-xs text-cyan-200/70 group-hover:text-cyan-100">
        Open module →
      </p>
    </Link>
  );
}

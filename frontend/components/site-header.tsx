"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeControl } from "@/components/theme-control";

export function SiteHeader() {
  const pathname = usePathname();
  if (
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/jarvis")
  ) {
    return null;
  }

  return (
    <header className="absolute top-0 right-0 left-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-6 sm:py-5">
      <Link href="/" className="text-sm tracking-[0.18em] text-white/70 uppercase">
        Private
      </Link>
      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        <ThemeControl />
        <nav className="flex items-center gap-1 text-xs sm:gap-3 sm:text-sm">
          <Link href="/login" className="rounded-full px-2.5 py-2 text-white/60 hover:text-white sm:px-4">
            Log in
          </Link>
          <Link href="/signup" className="rounded-full bg-white px-3 py-2 text-black sm:px-4">
            Sign up
          </Link>
        </nav>
      </div>
    </header>
  );
}

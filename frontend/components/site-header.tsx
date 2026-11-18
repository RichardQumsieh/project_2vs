"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SophiaMark } from "@/components/sophia-mark";
import { useViewerSession } from "@/lib/use-viewer";

const primaryAction =
  "inline-flex h-10 items-center justify-center rounded-full bg-(--foreground) px-4 text-sm font-medium text-(--background) hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)";

const quietAction =
  "inline-flex h-10 items-center justify-center rounded-full px-3 text-sm text-(--muted) hover:text-(--foreground) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)";

export function SiteHeader() {
  const pathname = usePathname();
  const viewer = useViewerSession();
  if (
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/sophia")
  ) {
    return null;
  }

  const account = viewer.data?.user;
  const pending = viewer.isPending;
  const name = account?.displayName || account?.username;

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-(--line) px-4 py-3 sm:px-6">
      <Link href="/" className="flex items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)">
        <SophiaMark />
        <span className="text-sm font-semibold tracking-[-0.02em] text-(--foreground)">Sophia</span>
      </Link>
      <div className="ml-auto flex items-center gap-2">
        <nav aria-label="Account" aria-busy={pending} className="flex min-h-10 min-w-28 items-center justify-end gap-1">
          {pending ? (
            <span className="sr-only">Checking session</span>
          ) : account ? (
            <>
              <span className="max-w-32 truncate px-2 text-sm text-(--muted)">{name}</span>
              <Link href="/inbox" className={primaryAction}>Open inbox</Link>
            </>
          ) : (
            <>
              <Link href="/login" className={quietAction}>Log in</Link>
              <Link href="/signup" className={primaryAction}>Sign up</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

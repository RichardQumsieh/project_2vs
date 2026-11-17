"use client";

import Link from "next/link";
import { SophiaMark } from "@/components/sophia-mark";
import { useViewerSession } from "@/lib/use-viewer";

const primaryAction =
  "inline-flex h-11 items-center justify-center rounded-full bg-(--foreground) px-5 text-sm font-medium text-(--background) hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)";

export function Homepage() {
  const viewer = useViewerSession();
  const signedIn = Boolean(viewer.data?.user);

  return (
    <main className="home-entry mx-auto flex w-full max-w-3xl flex-col px-4 py-14 sm:px-6 sm:py-20">
      <p className="text-xs font-medium tracking-[0.16em] text-(--muted) uppercase">
        Private messenger
      </p>
      <div className="mt-5 flex items-center gap-3">
        <SophiaMark large />
        <h1 className="text-4xl font-semibold tracking-[-0.045em] text-(--foreground) sm:text-6xl">
          Sophia
        </h1>
      </div>
      <p className="mt-5 max-w-xl text-lg leading-7 text-(--foreground) sm:text-xl sm:leading-8">
        Your chief of staff, inside the messenger.
      </p>
      <p className="mt-3 max-w-xl text-sm leading-6 text-(--muted) sm:text-base">
        Encrypted conversations stay on your devices. Sophia helps you keep the work moving from the inbox.
      </p>
      <ul className="mt-6 flex flex-col gap-2 text-sm text-(--muted) sm:flex-row sm:gap-6">
        <li>End-to-end encrypted</li>
        <li>Authenticator sign-in</li>
        <li>Works in the inbox</li>
      </ul>
      <div className="mt-8">
        {viewer.isPending ? (
          <p role="status" className="text-sm text-(--muted)">Checking your session…</p>
        ) : signedIn ? (
          <Link href="/inbox" className={primaryAction}>Open inbox</Link>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <Link href="/signup" className={primaryAction}>Create your account</Link>
            <Link
              href="/login"
              className="text-sm text-(--muted) underline-offset-4 hover:text-(--foreground) hover:underline"
            >
              Log in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

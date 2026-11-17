import { SophiaLockup } from "@/components/sophia-mark";

export function AuthPageShell({
  eyebrow,
  title,
  description,
  footer,
  children,
}: {
  eyebrow?: string;
  title?: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page mx-auto flex w-full max-w-md flex-col px-4 py-8 sm:py-14">
      <section className="rounded-2xl border border-(--line) bg-(--surface) px-5 py-6 sm:px-7 sm:py-8">
        <SophiaLockup />
        {eyebrow ? (
          <p className="mt-6 text-xs font-medium tracking-[0.16em] text-(--muted) uppercase">{eyebrow}</p>
        ) : null}
        {title ? (
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-(--foreground)">{title}</h1>
        ) : null}
        {description ? (
          <p className="mt-2 text-sm leading-6 text-(--muted)">{description}</p>
        ) : null}
        <div className="mt-6">{children}</div>
        {footer ? (
          <div className="mt-6 border-t border-(--line) pt-4 text-center text-sm text-(--muted)">
            {footer}
          </div>
        ) : null}
      </section>
    </main>
  );
}

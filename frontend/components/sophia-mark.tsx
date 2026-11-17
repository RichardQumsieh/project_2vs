export function SophiaMark({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? "sophia-mark sophia-mark-lg" : "sophia-mark"} aria-hidden="true">
      S
    </span>
  );
}

export function SophiaLockup() {
  return (
    <div className="flex items-center gap-3">
      <SophiaMark />
      <div>
        <p className="text-sm font-semibold tracking-[-0.02em] text-(--foreground)">Sophia</p>
        <p className="text-xs text-(--muted)">Chief of staff</p>
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
export { dominantScript, scriptCounts } from "./script";

export function BidiText({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span dir="auto" className={`bidi-plaintext ${className}`.trim()}>
      {children}
    </span>
  );
}

export function LtrIsolate({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <bdi dir="ltr" className={`isolate-ltr ${className}`.trim()}>
      {children}
    </bdi>
  );
}

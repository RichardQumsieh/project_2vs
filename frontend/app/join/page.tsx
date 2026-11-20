import { Suspense } from "react";
import { JoinWorkspace } from "@/components/join-workspace";

export default function Page() {
  return (
    <Suspense>
      <JoinWorkspace />
    </Suspense>
  );
}

import { MobileFlowPreview } from "@/components/mobile-flow-preview";
import { firstQueryValue, parseInboxHub } from "@/lib/inbox-hub";

export default async function MobilePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string | string[]; hub?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = firstQueryValue(params.surface);
  const surface = raw === "chat" || raw === "approvals" ? raw : "inbox";
  return <MobileFlowPreview surface={surface} hub={parseInboxHub(firstQueryValue(params.hub))} />;
}

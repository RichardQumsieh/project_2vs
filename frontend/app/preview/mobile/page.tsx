import { MobileFlowPreview } from "@/components/mobile-flow-preview";

export default async function MobilePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.surface) ? params.surface[0] : params.surface;
  const surface = raw === "chat" || raw === "approvals" ? raw : "inbox";
  return <MobileFlowPreview surface={surface} />;
}

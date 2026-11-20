import { DailyBriefScreen } from "@/components/daily-brief-screen";
import { firstQueryValue } from "@/lib/inbox-hub";

export default async function BriefPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ disconnected?: string | string[] }>;
}) {
  const params = await searchParams;
  return (
    <DailyBriefScreen
      mode="preview"
      disconnected={firstQueryValue(params.disconnected) === "1"}
    />
  );
}

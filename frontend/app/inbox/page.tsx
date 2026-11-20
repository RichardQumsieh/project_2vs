import { InboxHome } from "@/components/inbox-home";
import { InboxShell } from "@/components/inbox-app";
import {
  firstQueryValue,
  parseInboxHub,
  parseInboxMailView,
} from "@/lib/inbox-hub";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ hub?: string | string[]; view?: string | string[] }>;
}) {
  const params = await searchParams;
  const hub = parseInboxHub(firstQueryValue(params.hub));
  const mailView = parseInboxMailView(firstQueryValue(params.view));
  return (
    <InboxShell hub={hub} mailView={mailView}>
      <InboxHome hub={hub} />
    </InboxShell>
  );
}

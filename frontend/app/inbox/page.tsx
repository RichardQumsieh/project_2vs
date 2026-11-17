import { InboxHomeActivity } from "@/components/inbox-activity-panel";
import { InboxShell } from "@/components/inbox-app";

export default function InboxPage() {
  return (
    <InboxShell>
      <InboxHomeActivity />
    </InboxShell>
  );
}

import { redirect } from "next/navigation";
import { legacyActivityRedirect } from "@/lib/inbox-hub";

export default function ActivitySettingsPage() {
  redirect(legacyActivityRedirect());
}

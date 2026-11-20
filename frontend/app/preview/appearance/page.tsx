import { AppearanceSettings } from "@/components/appearance-settings";
import type { PanelId } from "@/lib/appearance/engine";

const panels = new Set<PanelId>(["inbox", "sophia", "settings", "integrations"]);

export default async function AppearancePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ hour?: string | string[]; role?: string | string[]; panel?: string | string[] }>;
}) {
  const params = await searchParams;
  const hourValue = Array.isArray(params.hour) ? params.hour[0] : params.hour;
  const roleValue = Array.isArray(params.role) ? params.role[0] : params.role;
  const panelValue = Array.isArray(params.panel) ? params.panel[0] : params.panel;
  const hourNumber = Number(hourValue);
  const hour = Number.isInteger(hourNumber) && hourNumber >= 0 && hourNumber <= 23 ? hourNumber : undefined;
  const role = roleValue === "family" || roleValue === "manager" ? roleValue : undefined;
  const topPanel = panelValue && panels.has(panelValue as PanelId) ? (panelValue as PanelId) : undefined;
  return <AppearanceSettings hour={hour} role={role} topPanel={topPanel} />;
}

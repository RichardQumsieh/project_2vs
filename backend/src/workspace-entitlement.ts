import { billingEnabled } from "./env.js";
import { dailyBriefAllowed, type BriefMembership } from "./plans.js";
import { prisma } from "./db.js";

function missingWorkspaceTable(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: string }).code;
  return code === "P2021" || code === "P2022";
}

/** Plan gate for the manager daily brief. Missing tables (before db push) keep the default. */
export async function dailyBriefEntitled(userId: string): Promise<boolean> {
  try {
    const rows = await prisma.workspaceMember.findMany({
      where: { userId },
      select: {
        workspace: {
          select: {
            planId: true,
            billing: { select: { status: true } },
          },
        },
      },
    });
    const memberships: BriefMembership[] = rows.map((row) => ({
      planId: row.workspace.planId,
      billingStatus: row.workspace.billing?.status ?? "comped",
    }));
    return dailyBriefAllowed({ memberships, billingEnabled });
  } catch (error) {
    if (missingWorkspaceTable(error)) return true;
    throw error;
  }
}

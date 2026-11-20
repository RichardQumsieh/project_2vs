/**
 * Plan catalog. Limits are enforced on the server.
 * Prices here are display labels. Nothing is charged unless billing is enabled
 * and a provider checkout succeeds. See docs/billing.md.
 */

export const planIds = ["FREE_FAMILY", "FAMILY_PLUS", "TEAM"] as const;
export type PlanId = (typeof planIds)[number];

export type WorkspaceKind = "FAMILY" | "TEAM";

export type PlanDefinition = {
  id: PlanId;
  kind: WorkspaceKind;
  /** Hard cap on members. Active unused invites also count toward this cap. */
  seatLimit: number;
  /** Seats allowed before a paid checkout is active. Owner only, for paid plans. */
  unpaidSeatLimit: number;
  /** Manager daily brief. Configurable per plan. Only the paid team plan includes it. */
  dailyBrief: boolean;
  paid: boolean;
  perSeat: boolean;
};

export const plans: Record<PlanId, PlanDefinition> = {
  FREE_FAMILY: {
    id: "FREE_FAMILY",
    kind: "FAMILY",
    seatLimit: 6,
    unpaidSeatLimit: 6,
    dailyBrief: false,
    paid: false,
    perSeat: false,
  },
  FAMILY_PLUS: {
    id: "FAMILY_PLUS",
    kind: "FAMILY",
    seatLimit: 12,
    unpaidSeatLimit: 1,
    dailyBrief: false,
    paid: true,
    perSeat: false,
  },
  TEAM: {
    id: "TEAM",
    kind: "TEAM",
    seatLimit: 50,
    unpaidSeatLimit: 1,
    dailyBrief: true,
    paid: true,
    perSeat: true,
  },
};

export type BillingStatus = "comped" | "incomplete" | "active" | "canceled" | "suspended" | "past_due";

export function isPlanId(value: string): value is PlanId {
  return (planIds as readonly string[]).includes(value);
}

export function getPlan(planId: string): PlanDefinition | null {
  return isPlanId(planId) ? plans[planId] : null;
}

export function defaultPlanForKind(kind: WorkspaceKind): PlanId {
  return kind === "TEAM" ? "TEAM" : "FREE_FAMILY";
}

export function initialBillingStatus(input: {
  planId: PlanId;
  billingEnabled: boolean;
}): BillingStatus {
  const plan = plans[input.planId];
  if (!plan.paid) return "comped";
  if (!input.billingEnabled) return "comped";
  return "incomplete";
}

/** A paid plan is entitled when billing is off (design partner) or the subscription is active/comped. */
export function planIsEntitled(input: {
  planId: string;
  billingStatus: string;
  billingEnabled: boolean;
}): boolean {
  const plan = getPlan(input.planId);
  if (!plan) return false;
  if (!plan.paid) return true;
  if (!input.billingEnabled) return input.billingStatus === "comped" || input.billingStatus === "active";
  return input.billingStatus === "active" || input.billingStatus === "comped";
}

export function effectiveSeatLimit(input: {
  planId: string;
  billingStatus: string;
  billingEnabled: boolean;
}): number | null {
  const plan = getPlan(input.planId);
  if (!plan) return null;
  if (planIsEntitled(input)) return plan.seatLimit;
  return plan.unpaidSeatLimit;
}

export function seatsAvailable(input: {
  planId: string;
  billingStatus: string;
  billingEnabled: boolean;
  memberCount: number;
  pendingInviteCount: number;
}): { ok: true; limit: number; used: number } | { ok: false; code: "unknown_plan" | "seat_limit"; limit: number; used: number } {
  const limit = effectiveSeatLimit(input);
  if (limit === null) return { ok: false, code: "unknown_plan", limit: 0, used: input.memberCount };
  const used = input.memberCount + input.pendingInviteCount;
  if (used >= limit) return { ok: false, code: "seat_limit", limit, used };
  return { ok: true, limit, used };
}

export type BriefMembership = {
  planId: string;
  billingStatus: string;
};

/**
 * People with no workspace keep the product default (the global brief flag).
 * After they belong to a workspace, the brief is on only when a plan that
 * includes it is entitled. Today that is the Team plan.
 */
export function dailyBriefAllowed(input: {
  memberships: BriefMembership[];
  billingEnabled: boolean;
}): boolean {
  if (input.memberships.length === 0) return true;
  return input.memberships.some((membership) => {
    const plan = getPlan(membership.planId);
    if (!plan?.dailyBrief) return false;
    return planIsEntitled({
      planId: membership.planId,
      billingStatus: membership.billingStatus,
      billingEnabled: input.billingEnabled,
    });
  });
}

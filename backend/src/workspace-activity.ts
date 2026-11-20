export const workspaceActivityActions = [
  "WORKSPACE_CREATED",
  "INVITE_CREATED",
  "INVITE_REVOKED",
  "INVITE_REDEEMED",
  "WORKSPACE_MEMBER_REMOVED",
  "WORKSPACE_ROLE_CHANGED",
] as const;

export type WorkspaceActivityAction = (typeof workspaceActivityActions)[number];

const allowed = new Set<string>(workspaceActivityActions);

function clip(value: string, max: number) {
  const cleaned = value.replace(/[\r\n]+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

export type WorkspaceAuditEvent = {
  ownerUserId: string;
  actorUserId: string;
  actorLabel: string;
  action: WorkspaceActivityAction;
  summary: string;
  subjectKind: "workspace" | "invite";
  subjectId: string;
};

/**
 * One row for the actor and one for each other account that should see it
 * (workspace owner, invite creator). Summaries never include the invite code.
 */
export function workspaceAuditEvents(input: {
  actorUserId: string;
  actorLabel: string;
  audienceUserIds: readonly string[];
  action: string;
  summary: string;
  subjectKind: "workspace" | "invite";
  subjectId: string;
}): { ok: true; events: WorkspaceAuditEvent[] } | { ok: false; error: string } {
  if (!allowed.has(input.action)) return { ok: false, error: "That activity action is not recorded." };
  const actorLabel = clip(input.actorLabel, 80);
  const summary = clip(input.summary, 160);
  const subjectId = clip(input.subjectId, 80);
  if (!actorLabel || !summary || !subjectId) return { ok: false, error: "Activity metadata is empty or too long." };
  const owners = [...new Set(input.audienceUserIds.filter((id) => id.length > 0))];
  if (!owners.includes(input.actorUserId)) owners.unshift(input.actorUserId);
  return {
    ok: true,
    events: owners.map((ownerUserId) => ({
      ownerUserId,
      actorUserId: input.actorUserId,
      actorLabel,
      action: input.action as WorkspaceActivityAction,
      summary,
      subjectKind: input.subjectKind,
      subjectId,
    })),
  };
}

export function workspaceCreatedSummary(name: string) {
  return `Created workspace ${name}`;
}

export function inviteCreatedSummary(name: string) {
  return `Created an invite for ${name}`;
}

export function inviteRevokedSummary(name: string) {
  return `Revoked an invite for ${name}`;
}

export function inviteRedeemedSummary(name: string) {
  return `Joined ${name} with an invite`;
}

export function memberRemovedSummary(name: string) {
  return `Removed a member from ${name}`;
}

export function roleChangedSummary(name: string, role: string) {
  return `Changed a role in ${name} to ${role}`;
}

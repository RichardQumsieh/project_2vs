export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

const roles: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER"];

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (roles as readonly string[]).includes(value);
}

export function canManageInvites(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canChangeRoles(role: WorkspaceRole): boolean {
  return role === "OWNER";
}

export type PolicyFailure = { ok: false; code: string; error: string };
export type PolicyOk = { ok: true };

function deny(code: string, error: string): PolicyFailure {
  return { ok: false, code, error };
}

export function planMemberRemoval(input: {
  actorRole: WorkspaceRole;
  actorId: string;
  targetRole: WorkspaceRole;
  targetId: string;
}): PolicyOk | PolicyFailure {
  if (input.actorId === input.targetId) {
    return deny("cannot_remove_self", "Leave is not available. Ask another owner to remove you.");
  }
  if (input.targetRole === "OWNER") {
    return deny("owner_protected", "Transfer ownership before removing an owner.");
  }
  if (input.actorRole === "OWNER") return { ok: true };
  if (input.actorRole === "ADMIN" && input.targetRole === "MEMBER") return { ok: true };
  return deny("forbidden", "You cannot remove that member.");
}

/**
 * Owner sets admin or member, or transfers ownership.
 * Transfer makes the target the only owner and the current owner an admin.
 */
export function planRoleUpdate(input: {
  actorRole: WorkspaceRole;
  actorId: string;
  targetRole: WorkspaceRole;
  targetId: string;
  nextRole: WorkspaceRole;
}): PolicyOk | PolicyFailure | { ok: true; transfer: true } {
  if (input.actorRole !== "OWNER") {
    return deny("forbidden", "Only an owner can change roles.");
  }
  if (input.actorId === input.targetId) {
    return deny("forbidden", "You cannot change your own role.");
  }
  if (input.targetRole === "OWNER") {
    return deny("owner_protected", "This workspace already has an owner.");
  }
  if (input.nextRole === "OWNER") return { ok: true, transfer: true };
  if (input.nextRole === "ADMIN" || input.nextRole === "MEMBER") return { ok: true };
  return deny("forbidden", "That role is not available.");
}

export type InviteSnapshot = {
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
};

/** Expired, used, revoked, and unknown invites share one code so probes learn nothing. */
export function inviteRedeemDecision(input: {
  invite: InviteSnapshot | null;
  now: Date;
  alreadyMember: boolean;
}): PolicyOk | PolicyFailure {
  const invite = input.invite;
  if (!invite || invite.revokedAt || invite.consumedAt || invite.expiresAt.getTime() <= input.now.getTime()) {
    return deny("invite_invalid", "This invite is not valid.");
  }
  if (input.alreadyMember) {
    return deny("already_member", "You are already in this workspace.");
  }
  return { ok: true };
}

export function membersShareWorkspace(input: {
  workspaceMemberIds: readonly string[];
  requiredUserIds: readonly string[];
}): PolicyOk | PolicyFailure {
  const present = new Set(input.workspaceMemberIds);
  if (input.requiredUserIds.some((userId) => !present.has(userId))) {
    return deny("not_in_workspace", "Everyone in this chat must already be in the workspace.");
  }
  return { ok: true };
}

const namePattern = /^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,58}[\p{L}\p{N}.]$/u;

export function normalizeWorkspaceName(value: string): string | null {
  const cleaned = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 2 || cleaned.length > 60) return null;
  if (!namePattern.test(cleaned)) return null;
  return cleaned;
}

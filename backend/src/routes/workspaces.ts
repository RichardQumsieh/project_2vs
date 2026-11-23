import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { tryRecordWorkspaceActivity } from "../account-activity-store.js";
import { requireUser } from "../auth.js";
import { billingProvider } from "../billing-runtime.js";
import { prisma } from "../db.js";
import { billingEnabled, env, groupE2eeEnabled } from "../env.js";
import { gateGroupE2ee, planGroupMembers } from "../group-e2ee.js";
import {
  defaultInviteHours,
  generateInviteCode,
  hashInviteCode,
  inviteCodeHint,
  inviteExpiry,
  invitePath,
  normalizeInviteCode,
} from "../invite-code.js";
import { inviteCreateLimit, invitePreviewLimit, inviteRedeemLimit, takeInviteSlot } from "../invite-rate.js";
import {
  dailyBriefAllowed,
  defaultPlanForKind,
  effectiveSeatLimit,
  getPlan,
  initialBillingStatus,
  seatsAvailable,
  type PlanId,
} from "../plans.js";
import {
  createWorkspaceInviteSchema,
  createWorkspaceSchema,
  previewWorkspaceInviteQuery,
  redeemWorkspaceInviteSchema,
  updateWorkspaceRoleSchema,
  paypalConfirmSchema,
  workspaceCheckoutSchema,
  workspaceDirectSchema,
  workspaceDirectoryQuery,
  workspaceGroupSchema,
} from "../schemas.js";
import { directKeyFor } from "../util.js";
import {
  canChangeRoles,
  canManageInvites,
  inviteRedeemDecision,
  membersShareWorkspace,
  normalizeWorkspaceName,
  planMemberRemoval,
  planRoleUpdate,
  type WorkspaceRole,
} from "../workspace-policy.js";
import {
  inviteCreatedSummary,
  inviteRedeemedSummary,
  inviteRevokedSummary,
  workspaceMemberAddedSummary,
  memberRemovedSummary,
  roleChangedSummary,
  workspaceCreatedSummary,
} from "../workspace-activity.js";
import { serializeConversation } from "./conversations.js";

const createInviteRate = { max: 8, timeWindow: "1 hour" };
const redeemRate = { max: 20, timeWindow: "15 minutes" };
const previewRate = { max: 30, timeWindow: "15 minutes" };

function billingOf(workspace: { planId: string; billing: { status: string } | null }) {
  return {
    planId: workspace.planId,
    billingStatus: workspace.billing?.status ?? "comped",
    billingEnabled,
  };
}

function presentWorkspace(input: {
  id: string;
  name: string;
  kind: "FAMILY" | "TEAM";
  planId: string;
  role: WorkspaceRole;
  seatCount: number;
  billing: { status: string } | null;
}) {
  const gate = billingOf(input);
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    planId: input.planId,
    role: input.role,
    seatCount: input.seatCount,
    seatLimit: effectiveSeatLimit(gate) ?? 0,
    dailyBrief: dailyBriefAllowed({
      memberships: [{ planId: input.planId, billingStatus: gate.billingStatus }],
      billingEnabled,
    }),
    billingStatus: gate.billingStatus,
    billingEnabled,
    billingProvider: billingEnabled ? env.BILLING_PROVIDER : "off",
  };
}

function paypalReturnUrl(workspaceId: string) {
  return `${env.FRONTEND_ORIGIN}/billing/paypal/return?workspace=${encodeURIComponent(workspaceId)}`;
}

function paypalCancelUrl(workspaceId: string) {
  return `${env.FRONTEND_ORIGIN}/billing/paypal/cancel?workspace=${encodeURIComponent(workspaceId)}`;
}

async function syncPaypalSeatQuantity(
  log: FastifyBaseLogger,
  workspace: {
    id: string;
    planId: string;
    billing: {
      provider: string;
      status: string;
      externalSubscriptionId: string | null;
      seatQuantity: number;
    } | null;
  },
) {
  if (billingProvider.id !== "paypal") return;
  const plan = getPlan(workspace.planId);
  const billing = workspace.billing;
  if (!plan?.perSeat || !billing || billing.provider !== "paypal" || billing.status !== "active") return;
  if (!billing.externalSubscriptionId) return;
  const memberCount = await prisma.workspaceMember.count({ where: { workspaceId: workspace.id } });
  const quantity = Math.min(plan.seatLimit, Math.max(1, memberCount));
  if (quantity === billing.seatQuantity) return;
  const updated = await billingProvider.updateSeatQuantity({
    subscriptionId: billing.externalSubscriptionId,
    seatQuantity: quantity,
    returnUrl: paypalReturnUrl(workspace.id),
    cancelUrl: paypalCancelUrl(workspace.id),
  });
  if (!updated.ok || updated.status !== "active") {
    log.info({ billing: true, provider: "paypal", outcome: updated.ok ? "seat_quantity_needs_approval" : "seat_quantity_failed" }, "billing seats");
    return;
  }
  await prisma.workspaceBilling.update({
    where: { workspaceId: workspace.id },
    data: { seatQuantity: updated.seatQuantity },
  });
  log.info({ billing: true, provider: "paypal", outcome: "seat_quantity_updated" }, "billing seats");
}

async function actorIn(workspaceId: string, userId: string) {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { workspace: { include: { billing: true } } },
  });
}

async function pendingInvites(workspaceId: string, now: Date) {
  return prisma.workspaceInvite.count({
    where: {
      workspaceId,
      consumedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });
}

function publicMember(member: {
  userId: string;
  role: WorkspaceRole;
  joinedAt: Date;
  user: { username: string; displayName: string | null };
}) {
  return {
    userId: member.userId,
    username: member.user.username,
    displayName: member.user.displayName,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}

export async function workspaceRoutes(app: FastifyInstance) {
  app.get("/workspaces", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    const rows = await prisma.workspaceMember.findMany({
      where: { userId: session.sub },
      include: {
        workspace: { include: { billing: true, _count: { select: { members: true } } } },
      },
      orderBy: { joinedAt: "asc" },
    });
    return {
      workspaces: rows.map((row) => presentWorkspace({
        ...row.workspace,
        role: row.role,
        seatCount: row.workspace._count.members,
      })),
    };
  });

  app.post(
    "/workspaces",
    { bodyLimit: 2 * 1024, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      const parsed = createWorkspaceSchema.safeParse(request.body);
      const name = parsed.success ? normalizeWorkspaceName(parsed.data.name) : null;
      if (!parsed.success || !name) {
        return reply.code(400).send({ error: "Enter a workspace name.", code: "invalid_workspace" });
      }
      const planId = defaultPlanForKind(parsed.data.kind);
      const status = initialBillingStatus({ planId, billingEnabled });
      const workspace = await prisma.workspace.create({
        data: {
          name,
          kind: parsed.data.kind,
          planId,
          billing: {
            create: {
              provider: billingEnabled ? env.BILLING_PROVIDER : "none",
              status,
              seatQuantity: 1,
            },
          },
          members: { create: { userId: session.sub, role: "OWNER" } },
        },
        include: { billing: true },
      });
      await tryRecordWorkspaceActivity({
        actorUserId: session.sub,
        actorLabel: session.username,
        audienceUserIds: [session.sub],
        action: "WORKSPACE_CREATED",
        summary: workspaceCreatedSummary(name),
        subjectKind: "workspace",
        subjectId: workspace.id,
      });
      reply.header("Cache-Control", "no-store");
      return reply.code(201).send({
        workspace: presentWorkspace({ ...workspace, role: "OWNER", seatCount: 1 }),
      });
    },
  );

  app.get("/workspaces/:id", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const actor = await actorIn(id, session.sub);
    if (!actor) return reply.code(404).send({ error: "Workspace not found" });
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      include: { user: { select: { username: true, displayName: true } } },
      orderBy: { joinedAt: "asc" },
    });
    const invites = canManageInvites(actor.role)
      ? await prisma.workspaceInvite.findMany({
          where: { workspaceId: id },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: {
            id: true,
            codeHint: true,
            expiresAt: true,
            consumedAt: true,
            revokedAt: true,
            createdAt: true,
          },
        })
      : [];
    reply.header("Cache-Control", "no-store");
    return {
      workspace: presentWorkspace({
        ...actor.workspace,
        role: actor.role,
        seatCount: members.length,
      }),
      members: members.map(publicMember),
      invites: invites.map((invite) => ({
        id: invite.id,
        hint: invite.codeHint,
        expiresAt: invite.expiresAt.toISOString(),
        consumedAt: invite.consumedAt?.toISOString() ?? null,
        revokedAt: invite.revokedAt?.toISOString() ?? null,
        createdAt: invite.createdAt.toISOString(),
      })),
    };
  });

  app.get("/workspaces/:id/members", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = workspaceDirectoryQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid search" });
    const actor = await actorIn(id, session.sub);
    if (!actor) return reply.code(404).send({ error: "Workspace not found" });
    const query = parsed.data.q?.trim().replace(/^@+/, "").toLowerCase();
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      include: { user: { select: { username: true, displayName: true } } },
      orderBy: { joinedAt: "asc" },
    });
    const filtered = query
      ? members.filter((member) => {
          const name = (member.user.displayName ?? "").toLowerCase();
          return member.user.username.toLowerCase().includes(query) || name.includes(query);
        })
      : members;
    reply.header("Cache-Control", "no-store");
    return { members: filtered.map(publicMember) };
  });

  app.post("/workspaces/:id/members", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = workspaceDirectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a valid Sophia username." });
    const actor = await actorIn(id, session.sub);
    if (!actor) return reply.code(404).send({ error: "Workspace not found" });
    if (!canManageInvites(actor.role)) {
      return reply.code(403).send({ error: "Only an owner or admin can add members.", code: "forbidden" });
    }

    const user = await prisma.user.findUnique({
      where: { username: parsed.data.username },
      select: { id: true, username: true, displayName: true },
    });
    if (!user) return reply.code(404).send({ error: "No Sophia account has that username.", code: "user_not_found" });
    const membershipKey = { workspaceId_userId: { workspaceId: id, userId: user.id } };
    if (await prisma.workspaceMember.findUnique({ where: membershipKey })) {
      return reply.code(409).send({ error: "That person is already a member.", code: "already_member" });
    }

    const now = new Date();
    const [memberCount, pendingInviteCount] = await Promise.all([
      prisma.workspaceMember.count({ where: { workspaceId: id } }),
      pendingInvites(id, now),
    ]);
    const seats = seatsAvailable({
      ...billingOf(actor.workspace),
      memberCount,
      pendingInviteCount,
    });
    if (!seats.ok) {
      return reply.code(402).send({
        error: `This plan has ${seats.limit} seats.`,
        code: seats.code,
        seatLimit: seats.limit,
      });
    }

    let member: {
      userId: string;
      role: WorkspaceRole;
      joinedAt: Date;
      user: { username: string; displayName: string | null };
    };
    try {
      member = await prisma.workspaceMember.create({
        data: { workspaceId: id, userId: user.id, role: "MEMBER" },
        include: { user: { select: { username: true, displayName: true } } },
      });
    } catch (error) {
      if (await prisma.workspaceMember.findUnique({ where: membershipKey })) {
        return reply.code(409).send({ error: "That person is already a member.", code: "already_member" });
      }
      throw error;
    }

    const owner = await prisma.workspaceMember.findFirst({
      where: { workspaceId: id, role: "OWNER" },
      select: { userId: true },
    });
    await tryRecordWorkspaceActivity({
      actorUserId: session.sub,
      actorLabel: session.username,
      audienceUserIds: [session.sub, owner?.userId ?? session.sub, user.id],
      action: "WORKSPACE_MEMBER_ADDED",
      summary: workspaceMemberAddedSummary(actor.workspace.name, user.username),
      subjectKind: "workspace",
      subjectId: id,
    });
    await syncPaypalSeatQuantity(request.log, actor.workspace);
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ member: publicMember(member) });
  });

  app.patch("/workspaces/:id/members/:userId", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id, userId } = request.params as { id: string; userId: string };
    const parsed = updateWorkspaceRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid role" });
    const actor = await actorIn(id, session.sub);
    if (!actor) return reply.code(404).send({ error: "Workspace not found" });
    if (!canChangeRoles(actor.role)) {
      return reply.code(403).send({ error: "Only an owner can change roles.", code: "forbidden" });
    }
    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId } },
    });
    if (!target) return reply.code(404).send({ error: "Member not found" });
    const planned = planRoleUpdate({
      actorRole: actor.role,
      actorId: session.sub,
      targetRole: target.role,
      targetId: userId,
      nextRole: parsed.data.role,
    });
    if (!planned.ok) return reply.code(403).send({ error: planned.error, code: planned.code });
    if ("transfer" in planned && planned.transfer) {
      await prisma.$transaction([
        prisma.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId: id, userId } },
          data: { role: "OWNER" },
        }),
        prisma.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId: id, userId: session.sub } },
          data: { role: "ADMIN" },
        }),
      ]);
    } else {
      await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: id, userId } },
        data: { role: parsed.data.role },
      });
    }
    const owner = await prisma.workspaceMember.findFirst({
      where: { workspaceId: id, role: "OWNER" },
      select: { userId: true },
    });
    await tryRecordWorkspaceActivity({
      actorUserId: session.sub,
      actorLabel: session.username,
      audienceUserIds: [session.sub, owner?.userId ?? session.sub, userId],
      action: "WORKSPACE_ROLE_CHANGED",
      summary: roleChangedSummary(actor.workspace.name, parsed.data.role),
      subjectKind: "workspace",
      subjectId: id,
    });
    reply.header("Cache-Control", "no-store");
    return { ok: true as const };
  });

  app.delete("/workspaces/:id/members/:userId", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id, userId } = request.params as { id: string; userId: string };
    const actor = await actorIn(id, session.sub);
    if (!actor) return reply.code(404).send({ error: "Workspace not found" });
    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: id, userId } },
    });
    if (!target) return reply.code(404).send({ error: "Member not found" });
    const planned = planMemberRemoval({
      actorRole: actor.role,
      actorId: session.sub,
      targetRole: target.role,
      targetId: userId,
    });
    if (!planned.ok) return reply.code(403).send({ error: planned.error, code: planned.code });
    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: id, userId } },
    });
    await tryRecordWorkspaceActivity({
      actorUserId: session.sub,
      actorLabel: session.username,
      audienceUserIds: [session.sub, userId],
      action: "WORKSPACE_MEMBER_REMOVED",
      summary: memberRemovedSummary(actor.workspace.name),
      subjectKind: "workspace",
      subjectId: id,
    });
    await syncPaypalSeatQuantity(request.log, actor.workspace);
    reply.header("Cache-Control", "no-store");
    return { ok: true as const };
  });

  app.post(
    "/workspaces/:id/invites",
    { bodyLimit: 1024, config: { rateLimit: createInviteRate } },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      if (!takeInviteSlot(`create:${session.sub}`, Date.now(), inviteCreateLimit.max, inviteCreateLimit.windowMs)) {
        return reply.code(429).send({ error: "Too many invites. Try again later.", code: "rate_limited" });
      }
      const { id } = request.params as { id: string };
      const parsed = createWorkspaceInviteSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "Invalid invite" });
      const actor = await actorIn(id, session.sub);
      if (!actor) return reply.code(404).send({ error: "Workspace not found" });
      if (!canManageInvites(actor.role)) {
        return reply.code(403).send({ error: "Only an owner or admin can invite.", code: "forbidden" });
      }
      const now = new Date();
      const memberCount = await prisma.workspaceMember.count({ where: { workspaceId: id } });
      const pending = await pendingInvites(id, now);
      const seats = seatsAvailable({
        ...billingOf(actor.workspace),
        memberCount,
        pendingInviteCount: pending,
      });
      if (!seats.ok) {
        return reply.code(402).send({
          error: `This plan has ${seats.limit} seats.`,
          code: seats.code,
          seatLimit: seats.limit,
        });
      }
      const expiresAt = inviteExpiry(now, parsed.data.expiresInHours ?? defaultInviteHours);
      if (!expiresAt) return reply.code(400).send({ error: "Invalid invite expiry" });
      const code = generateInviteCode();
      const invite = await prisma.workspaceInvite.create({
        data: {
          workspaceId: id,
          createdByUserId: session.sub,
          codeHash: hashInviteCode(code),
          codeHint: inviteCodeHint(code),
          expiresAt,
        },
      });
      await tryRecordWorkspaceActivity({
        actorUserId: session.sub,
        actorLabel: session.username,
        audienceUserIds: [session.sub],
        action: "INVITE_CREATED",
        summary: inviteCreatedSummary(actor.workspace.name),
        subjectKind: "invite",
        subjectId: invite.id,
      });
      reply.header("Cache-Control", "no-store");
      return reply.code(201).send({
        invite: {
          id: invite.id,
          code,
          hint: invite.codeHint,
          expiresAt: expiresAt.toISOString(),
          path: invitePath(code),
        },
      });
    },
  );

  app.delete("/workspaces/:id/invites/:inviteId", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id, inviteId } = request.params as { id: string; inviteId: string };
    const actor = await actorIn(id, session.sub);
    if (!actor) return reply.code(404).send({ error: "Workspace not found" });
    if (!canManageInvites(actor.role)) {
      return reply.code(403).send({ error: "Only an owner or admin can revoke an invite.", code: "forbidden" });
    }
    const updated = await prisma.workspaceInvite.updateMany({
      where: { id: inviteId, workspaceId: id, consumedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count !== 1) return reply.code(404).send({ error: "Invite not found" });
    await tryRecordWorkspaceActivity({
      actorUserId: session.sub,
      actorLabel: session.username,
      audienceUserIds: [session.sub],
      action: "INVITE_REVOKED",
      summary: inviteRevokedSummary(actor.workspace.name),
      subjectKind: "invite",
      subjectId: inviteId,
    });
    reply.header("Cache-Control", "no-store");
    return { ok: true as const };
  });

  app.get(
    "/workspace-invites/preview",
    { config: { rateLimit: previewRate } },
    async (request, reply) => {
      const parsed = previewWorkspaceInviteQuery.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "This invite is not valid.", code: "invite_invalid" });
      }
      const ip = request.ip || "unknown";
      if (!takeInviteSlot(`preview:${ip}`, Date.now(), invitePreviewLimit.max, invitePreviewLimit.windowMs)) {
        return reply.code(429).send({ error: "Too many invite attempts. Try again later.", code: "rate_limited" });
      }
      const code = normalizeInviteCode(parsed.data.code);
      const invite = await prisma.workspaceInvite.findUnique({
        where: { codeHash: hashInviteCode(code) },
        include: { workspace: { select: { name: true, kind: true } } },
      });
      const decision = inviteRedeemDecision({
        invite: invite
          ? { expiresAt: invite.expiresAt, consumedAt: invite.consumedAt, revokedAt: invite.revokedAt }
          : null,
        now: new Date(),
        alreadyMember: false,
      });
      reply.header("Cache-Control", "no-store");
      if (!decision.ok) return reply.code(400).send({ error: decision.error, code: decision.code });
      return { workspace: { name: invite!.workspace.name, kind: invite!.workspace.kind } };
    },
  );

  app.post(
    "/workspace-invites/redeem",
    { bodyLimit: 1024, config: { rateLimit: redeemRate } },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      if (!takeInviteSlot(`redeem:${session.sub}`, Date.now(), inviteRedeemLimit.max, inviteRedeemLimit.windowMs)) {
        return reply.code(429).send({ error: "Too many invite attempts. Try again later.", code: "rate_limited" });
      }
      const parsed = redeemWorkspaceInviteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "This invite is not valid.", code: "invite_invalid" });
      }
      const code = normalizeInviteCode(parsed.data.code);
      const invite = await prisma.workspaceInvite.findUnique({
        where: { codeHash: hashInviteCode(code) },
        include: { workspace: { include: { billing: true } }, createdBy: { select: { id: true } } },
      });
      const existing = invite
        ? await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: session.sub } },
          })
        : null;
      const decision = inviteRedeemDecision({
        invite: invite
          ? { expiresAt: invite.expiresAt, consumedAt: invite.consumedAt, revokedAt: invite.revokedAt }
          : null,
        now: new Date(),
        alreadyMember: Boolean(existing),
      });
      if (!decision.ok || !invite) {
        return reply.code(400).send({
          error: decision.ok ? "This invite is not valid." : decision.error,
          code: decision.ok ? "invite_invalid" : decision.code,
        });
      }
      const memberCount = await prisma.workspaceMember.count({ where: { workspaceId: invite.workspaceId } });
      const seats = seatsAvailable({
        ...billingOf(invite.workspace),
        memberCount,
        pendingInviteCount: 0,
      });
      if (!seats.ok) {
        return reply.code(402).send({
          error: `This plan has ${seats.limit} seats.`,
          code: seats.code,
          seatLimit: seats.limit,
        });
      }
      const now = new Date();
      try {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.workspaceInvite.updateMany({
            where: {
              id: invite.id,
              consumedAt: null,
              revokedAt: null,
              expiresAt: { gt: now },
            },
            data: { consumedAt: now, consumedByUserId: session.sub },
          });
          if (updated.count !== 1) throw new Error("invite_invalid");
          await tx.workspaceMember.create({
            data: { workspaceId: invite.workspaceId, userId: session.sub, role: "MEMBER" },
          });
        });
      } catch {
        return reply.code(400).send({ error: "This invite is not valid.", code: "invite_invalid" });
      }
      const owner = await prisma.workspaceMember.findFirst({
        where: { workspaceId: invite.workspaceId, role: "OWNER" },
        select: { userId: true },
      });
      await tryRecordWorkspaceActivity({
        actorUserId: session.sub,
        actorLabel: session.username,
        audienceUserIds: [session.sub, owner?.userId ?? "", invite.createdBy.id],
        action: "INVITE_REDEEMED",
        summary: inviteRedeemedSummary(invite.workspace.name),
        subjectKind: "invite",
        subjectId: invite.id,
      });
      await syncPaypalSeatQuantity(request.log, invite.workspace);
      const count = memberCount + 1;
      reply.header("Cache-Control", "no-store");
      return {
        workspace: presentWorkspace({
          ...invite.workspace,
          role: "MEMBER",
          seatCount: count,
        }),
      };
    },
  );

  app.post(
    "/workspaces/:id/billing/checkout",
    { bodyLimit: 1024, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const session = await requireUser(request, reply);
      if (!session) return;
      const { id } = request.params as { id: string };
      const parsed = workspaceCheckoutSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid plan" });
      const actor = await actorIn(id, session.sub);
      if (!actor) return reply.code(404).send({ error: "Workspace not found" });
      if (actor.role !== "OWNER") {
        return reply.code(403).send({ error: "Only an owner can change the plan.", code: "forbidden" });
      }
      const plan = getPlan(parsed.data.planId);
      if (!plan || plan.kind !== actor.workspace.kind) {
        return reply.code(400).send({ error: "That plan does not fit this workspace.", code: "invalid_plan" });
      }
      const memberCount = await prisma.workspaceMember.count({ where: { workspaceId: id } });
      const quantity = plan.perSeat
        ? Math.max(memberCount, parsed.data.seatQuantity ?? memberCount)
        : 1;
      if (!plan.paid) {
        if (memberCount > plan.seatLimit) {
          return reply.code(402).send({
            error: `This plan has ${plan.seatLimit} seats.`,
            code: "seat_limit",
            seatLimit: plan.seatLimit,
          });
        }
        await prisma.workspace.update({
          where: { id },
          data: {
            planId: plan.id,
            billing: { update: { status: "comped", provider: "none", seatQuantity: memberCount } },
          },
        });
        reply.header("Cache-Control", "no-store");
        return { ok: true as const, status: "comped", checkoutUrl: null };
      }
      if (quantity > plan.seatLimit) {
        return reply.code(402).send({
          error: `This plan has ${plan.seatLimit} seats.`,
          code: "seat_limit",
          seatLimit: plan.seatLimit,
        });
      }
      const billingRow = actor.workspace.billing;
      const paypalSeats = billingProvider.id === "paypal"
        && plan.perSeat
        && billingRow?.provider === "paypal"
        && billingRow.status === "active"
        && Boolean(billingRow.externalSubscriptionId)
        && actor.workspace.planId === plan.id;
      if (paypalSeats && billingRow?.externalSubscriptionId) {
        if (billingRow.seatQuantity === quantity) {
          reply.header("Cache-Control", "no-store");
          return { ok: true as const, status: "active" as const, checkoutUrl: null };
        }
        const updated = await billingProvider.updateSeatQuantity({
          subscriptionId: billingRow.externalSubscriptionId,
          seatQuantity: quantity,
          returnUrl: paypalReturnUrl(id),
          cancelUrl: paypalCancelUrl(id),
        });
        if (!updated.ok) {
          const status = updated.code === "billing_disabled" ? 403 : 503;
          return reply.code(status).send({ error: updated.error, code: updated.code });
        }
        if (updated.status === "active") {
          await prisma.workspaceBilling.update({
            where: { workspaceId: id },
            data: { seatQuantity: updated.seatQuantity },
          });
        }
        reply.header("Cache-Control", "no-store");
        return {
          ok: true as const,
          status: updated.status,
          checkoutUrl: updated.checkoutUrl,
        };
      }
      const email = await prisma.user.findUnique({
        where: { id: session.sub },
        select: { email: true },
      });
      const paypal = billingProvider.id === "paypal";
      const checkout = await billingProvider.createCheckout({
        workspaceId: id,
        planId: plan.id as PlanId,
        seatQuantity: quantity,
        customerEmail: email?.email ?? "",
        successUrl: paypal
          ? paypalReturnUrl(id)
          : `${env.FRONTEND_ORIGIN}/settings/workspace?billing=success`,
        cancelUrl: paypal
          ? paypalCancelUrl(id)
          : `${env.FRONTEND_ORIGIN}/settings/workspace?billing=cancel`,
      });
      if (!checkout.ok) {
        const status = checkout.code === "billing_disabled" ? 403 : 503;
        return reply.code(status).send({ error: checkout.error, code: checkout.code });
      }
      await prisma.workspaceBilling.update({
        where: { workspaceId: id },
        data: {
          provider: checkout.provider,
          status: checkout.status,
          externalSubscriptionId: checkout.externalSubscriptionId,
          seatQuantity: quantity,
          pendingPlanId: checkout.provider === "paypal" ? plan.id : null,
        },
      });
      if (checkout.status === "active") {
        await prisma.workspace.update({ where: { id }, data: { planId: plan.id } });
      }
      reply.header("Cache-Control", "no-store");
      return {
        ok: true as const,
        status: checkout.status,
        checkoutUrl: checkout.checkoutUrl,
      };
    },
  );

  app.post(
    "/workspaces/:id/billing/paypal/confirm",
    { bodyLimit: 1024, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } },
    async (request, reply) => {
      if (!billingEnabled || env.BILLING_PROVIDER !== "paypal") {
        return reply.code(404).send({ error: "PayPal billing is off." });
      }
      const session = await requireUser(request, reply);
      if (!session) return;
      const { id } = request.params as { id: string };
      const parsed = paypalConfirmSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid subscription", code: "billing_mismatch" });
      const actor = await actorIn(id, session.sub);
      if (!actor) return reply.code(404).send({ error: "Workspace not found" });
      if (actor.role !== "OWNER") {
        return reply.code(403).send({ error: "Only an owner can change the plan.", code: "forbidden" });
      }
      const billingRow = actor.workspace.billing;
      if (!billingRow?.externalSubscriptionId || billingRow.externalSubscriptionId !== parsed.data.subscriptionId) {
        return reply.code(400).send({
          error: "This return does not match a checkout we started.",
          code: "billing_mismatch",
        });
      }
      const confirmed = await billingProvider.confirmSubscription({
        subscriptionId: billingRow.externalSubscriptionId,
        workspaceId: id,
      });
      if (!confirmed.ok) {
        const status = confirmed.code === "billing_mismatch" ? 400 : 503;
        return reply.code(status).send({ error: confirmed.error, code: confirmed.code });
      }
      if (confirmed.granted && confirmed.status === "active" && confirmed.planId) {
        await prisma.workspace.update({
          where: { id },
          data: {
            planId: confirmed.planId,
            billing: {
              update: {
                provider: "paypal",
                status: "active",
                externalCustomerId: confirmed.externalCustomerId,
                externalSubscriptionId: confirmed.externalSubscriptionId,
                seatQuantity: confirmed.seatQuantity,
                pendingPlanId: null,
              },
            },
          },
        });
      } else if (confirmed.status === "canceled" || confirmed.status === "suspended" || confirmed.status === "past_due") {
        await prisma.workspaceBilling.update({
          where: { workspaceId: id },
          data: { provider: "paypal", status: confirmed.status },
        });
      }
      request.log.info({ billing: true, provider: "paypal", outcome: confirmed.granted ? "granted" : confirmed.status }, "billing confirm");
      reply.header("Cache-Control", "no-store");
      return {
        ok: true as const,
        status: confirmed.status,
        granted: confirmed.granted,
        planId: confirmed.granted ? confirmed.planId : null,
      };
    },
  );

  app.post("/workspaces/:id/conversations/direct", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = workspaceDirectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const actor = await actorIn(id, session.sub);
    if (!actor) return reply.code(404).send({ error: "Workspace not found" });
    const peer = await prisma.user.findUnique({ where: { username: parsed.data.username } });
    if (!peer) return reply.code(404).send({ error: "User not found" });
    const shared = membersShareWorkspace({
      workspaceMemberIds: (await prisma.workspaceMember.findMany({
        where: { workspaceId: id },
        select: { userId: true },
      })).map((member) => member.userId),
      requiredUserIds: [session.sub, peer.id],
    });
    if (!shared.ok) return reply.code(403).send({ error: shared.error, code: shared.code });
    if (peer.id === session.sub) return reply.code(400).send({ error: "You cannot message yourself" });
    const key = directKeyFor(session.sub, peer.id);
    const conversation = await prisma.conversation.upsert({
      where: { directKey: key },
      create: {
        type: "DIRECT",
        directKey: key,
        initiatedByUserId: session.sub,
        members: { create: [{ userId: session.sub }, { userId: peer.id }] },
      },
      update: {},
      include: { members: { include: { user: true } } },
    });
    reply.header("Cache-Control", "no-store");
    return serializeConversation(conversation, session.sub);
  });

  app.post("/workspaces/:id/conversations/group", async (request, reply) => {
    const enabled = gateGroupE2ee(groupE2eeEnabled);
    if (!enabled.ok) return reply.code(enabled.status).send({ error: enabled.error, code: enabled.code });
    const session = await requireUser(request, reply);
    if (!session) return;
    const { id } = request.params as { id: string };
    const parsed = workspaceGroupSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });
    const actor = await actorIn(id, session.sub);
    if (!actor) return reply.code(404).send({ error: "Workspace not found" });
    const planned = planGroupMembers(session.sub, parsed.data.memberUserIds);
    if (!planned.ok) return reply.code(planned.status).send({ error: planned.error });
    const workspaceMemberIds = (await prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      select: { userId: true },
    })).map((member) => member.userId);
    const shared = membersShareWorkspace({
      workspaceMemberIds,
      requiredUserIds: planned.members.map((member) => member.userId),
    });
    if (!shared.ok) return reply.code(403).send({ error: shared.error, code: shared.code });
    const conversation = await prisma.conversation.create({
      data: {
        type: "GROUP",
        title: parsed.data.title,
        initiatedByUserId: session.sub,
        members: {
          create: planned.members.map((member) => ({ userId: member.userId, role: member.role })),
        },
      },
      include: { members: { include: { user: true } } },
    });
    reply.header("Cache-Control", "no-store");
    return serializeConversation(conversation, session.sub);
  });

  app.get("/me/entitlements", async (request, reply) => {
    const session = await requireUser(request, reply);
    if (!session) return;
    const rows = await prisma.workspaceMember.findMany({
      where: { userId: session.sub },
      include: { workspace: { include: { billing: true } } },
    });
    const memberships = rows.map((row) => ({
      planId: row.workspace.planId,
      billingStatus: row.workspace.billing?.status ?? "comped",
    }));
    reply.header("Cache-Control", "no-store");
    return {
      dailyBrief: dailyBriefAllowed({ memberships, billingEnabled }),
      billingEnabled,
      workspaces: rows.length,
    };
  });
}

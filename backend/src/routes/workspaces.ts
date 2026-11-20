import type { FastifyInstance } from "fastify";
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
  };
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
    const query = parsed.data.q?.toLowerCase();
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      include: { user: { select: { username: true, displayName: true } } },
      orderBy: { joinedAt: "asc" },
    });
    const filtered = query
      ? members.filter((member) => {
          const name = member.user.displayName?.toLowerCase() ?? "";
          return member.user.username.includes(query) || name.includes(query);
        })
      : members;
    reply.header("Cache-Control", "no-store");
    return { members: filtered.map(publicMember) };
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
      const email = await prisma.user.findUnique({
        where: { id: session.sub },
        select: { email: true },
      });
      const checkout = await billingProvider.createCheckout({
        workspaceId: id,
        planId: plan.id as PlanId,
        seatQuantity: quantity,
        customerEmail: email?.email ?? "",
        successUrl: `${env.FRONTEND_ORIGIN}/settings/workspace?billing=success`,
        cancelUrl: `${env.FRONTEND_ORIGIN}/settings/workspace?billing=cancel`,
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

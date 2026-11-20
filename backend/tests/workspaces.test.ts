import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { sanitizeActivityWrite } from "../src/account-activity.js";
import {
  createMockBilling,
  createStripeBilling,
  disabledBilling,
  interpretStripeEvent,
  selectBillingProvider,
  stripeCheckoutForm,
  verifyStripeSignature,
} from "../src/billing.js";
import {
  generateInviteCode,
  hashInviteCode,
  inviteCodeFromBytes,
  inviteCodeHint,
  inviteExpiry,
  inviteHashesMatch,
  normalizeInviteCode,
} from "../src/invite-code.js";
import { consumeBucket, inviteCreateLimit, inviteRedeemLimit } from "../src/invite-rate.js";
import {
  dailyBriefAllowed,
  effectiveSeatLimit,
  plans,
  seatsAvailable,
} from "../src/plans.js";
import { designPartnerSchema, recordActivitySchema } from "../src/schemas.js";
import {
  inviteCreatedSummary,
  inviteRedeemedSummary,
  workspaceAuditEvents,
} from "../src/workspace-activity.js";
import {
  inviteRedeemDecision,
  membersShareWorkspace,
  normalizeWorkspaceName,
  planMemberRemoval,
  planRoleUpdate,
} from "../src/workspace-policy.js";

const now = new Date("2026-06-01T12:00:00.000Z");

describe("workspace plans", () => {
  it("caps free family seats and keeps the brief off that plan", () => {
    assert.equal(plans.FREE_FAMILY.seatLimit, 6);
    assert.equal(plans.FREE_FAMILY.dailyBrief, false);
    assert.equal(plans.FAMILY_PLUS.dailyBrief, false);
    assert.equal(plans.TEAM.dailyBrief, true);
    assert.equal(plans.TEAM.perSeat, true);
    const full = seatsAvailable({
      planId: "FREE_FAMILY",
      billingStatus: "comped",
      billingEnabled: false,
      memberCount: 5,
      pendingInviteCount: 1,
    });
    assert.equal(full.ok, false);
    if (!full.ok) assert.equal(full.code, "seat_limit");
    const room = seatsAvailable({
      planId: "FREE_FAMILY",
      billingStatus: "comped",
      billingEnabled: false,
      memberCount: 5,
      pendingInviteCount: 0,
    });
    assert.equal(room.ok, true);
  });

  it("holds unpaid team workspaces to the owner until billing is active", () => {
    assert.equal(effectiveSeatLimit({
      planId: "TEAM",
      billingStatus: "incomplete",
      billingEnabled: true,
    }), 1);
    assert.equal(effectiveSeatLimit({
      planId: "TEAM",
      billingStatus: "comped",
      billingEnabled: false,
    }), 50);
    assert.equal(effectiveSeatLimit({
      planId: "TEAM",
      billingStatus: "active",
      billingEnabled: true,
    }), 50);
  });

  it("allows the daily brief for people without a workspace, and for an entitled team", () => {
    assert.equal(dailyBriefAllowed({ memberships: [], billingEnabled: false }), true);
    assert.equal(dailyBriefAllowed({
      memberships: [{ planId: "FREE_FAMILY", billingStatus: "comped" }],
      billingEnabled: false,
    }), false);
    assert.equal(dailyBriefAllowed({
      memberships: [{ planId: "TEAM", billingStatus: "incomplete" }],
      billingEnabled: true,
    }), false);
    assert.equal(dailyBriefAllowed({
      memberships: [{ planId: "TEAM", billingStatus: "comped" }],
      billingEnabled: false,
    }), true);
    assert.equal(dailyBriefAllowed({
      memberships: [
        { planId: "FREE_FAMILY", billingStatus: "comped" },
        { planId: "TEAM", billingStatus: "active" },
      ],
      billingEnabled: true,
    }), true);
  });
});

describe("workspace invites", () => {
  it("stores a hash, not the code, and treats used or expired invites as invalid", () => {
    const code = generateInviteCode();
    assert.equal(code.length, 12);
    assert.equal(normalizeInviteCode(` ${code.toLowerCase()} `), code);
    const fixed = inviteCodeFromBytes(Uint8Array.from({ length: 12 }, () => 10));
    const hash = hashInviteCode(fixed);
    assert.equal(fixed, "LLLLLLLLLLLL");
    assert.equal(hash.includes(fixed), false);
    assert.equal(hashInviteCode(code).length, 64);
    assert.equal(inviteCodeHint(code), code.slice(-4));
    assert.equal(inviteHashesMatch(hash, fixed), true);
    assert.equal(inviteHashesMatch(hash, `${fixed}X`), false);
    assert.equal(inviteCodeFromBytes(Uint8Array.from({ length: 12 }, () => 1)), "BBBBBBBBBBBB");

    const open = {
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
      revokedAt: null,
    };
    assert.equal(inviteRedeemDecision({ invite: open, now, alreadyMember: false }).ok, true);
    assert.equal(inviteRedeemDecision({ invite: null, now, alreadyMember: false }).ok, false);
    assert.equal(inviteRedeemDecision({
      invite: { ...open, consumedAt: now },
      now,
      alreadyMember: false,
    }).ok, false);
    assert.equal(inviteRedeemDecision({
      invite: { ...open, revokedAt: now },
      now,
      alreadyMember: false,
    }).ok, false);
    assert.equal(inviteRedeemDecision({
      invite: { ...open, expiresAt: now },
      now,
      alreadyMember: false,
    }).ok, false);
    const member = inviteRedeemDecision({ invite: open, now, alreadyMember: true });
    assert.equal(member.ok, false);
    if (!member.ok) assert.equal(member.code, "already_member");
    assert.equal(inviteExpiry(now, 24 * 15), null);
    assert.ok(inviteExpiry(now, 24));
  });

  it("rate-limits invite creation and redemption", () => {
    let stamps: number[] = [];
    for (let index = 0; index < inviteCreateLimit.max; index += 1) {
      const next = consumeBucket(stamps, 1_000, inviteCreateLimit.max, inviteCreateLimit.windowMs);
      assert.equal(next.ok, true);
      stamps = next.timestamps;
    }
    assert.equal(consumeBucket(stamps, 1_000, inviteCreateLimit.max, inviteCreateLimit.windowMs).ok, false);
    assert.equal(
      consumeBucket(stamps, 1_000 + inviteCreateLimit.windowMs, inviteCreateLimit.max, inviteCreateLimit.windowMs).ok,
      true,
    );
    let redeems: number[] = [];
    for (let index = 0; index < inviteRedeemLimit.max; index += 1) {
      const next = consumeBucket(redeems, 5_000, inviteRedeemLimit.max, inviteRedeemLimit.windowMs);
      assert.equal(next.ok, true);
      redeems = next.timestamps;
    }
    assert.equal(consumeBucket(redeems, 5_000, inviteRedeemLimit.max, inviteRedeemLimit.windowMs).ok, false);
  });

  it("writes activity rows without the invite code", () => {
    const code = "ABCD23456789";
    const summary = inviteCreatedSummary("Haddad");
    assert.equal(summary.includes(code), false);
    assert.equal(inviteRedeemedSummary("Haddad").includes(code), false);
    const built = workspaceAuditEvents({
      actorUserId: "member",
      actorLabel: "sara",
      audienceUserIds: ["owner", "member", "owner"],
      action: "INVITE_REDEEMED",
      summary,
      subjectKind: "invite",
      subjectId: "invite-1",
    });
    assert.equal(built.ok, true);
    if (built.ok) {
      assert.deepEqual(built.events.map((event) => event.ownerUserId).sort(), ["member", "owner"]);
      assert.equal(built.events.every((event) => event.summary === summary), true);
    }
    assert.equal(recordActivitySchema.safeParse({
      action: "INVITE_CREATED",
      summary: "Created an invite",
    }).success, false);
    assert.equal(sanitizeActivityWrite({
      ownerUserId: "owner",
      actorUserId: "member",
      actorLabel: "sara",
      action: "INVITE_CREATED",
      summary,
    }).ok, false);
  });
});

describe("workspace roles", () => {
  it("lets an owner transfer and keeps admins from removing owners", () => {
    const transfer = planRoleUpdate({
      actorRole: "OWNER",
      actorId: "owner",
      targetRole: "MEMBER",
      targetId: "member",
      nextRole: "OWNER",
    });
    assert.equal(transfer.ok, true);
    if (transfer.ok) assert.equal("transfer" in transfer, true);
    assert.equal(planRoleUpdate({
      actorRole: "ADMIN",
      actorId: "admin",
      targetRole: "MEMBER",
      targetId: "member",
      nextRole: "ADMIN",
    }).ok, false);
    assert.equal(planMemberRemoval({
      actorRole: "ADMIN",
      actorId: "admin",
      targetRole: "MEMBER",
      targetId: "member",
    }).ok, true);
    assert.equal(planMemberRemoval({
      actorRole: "ADMIN",
      actorId: "admin",
      targetRole: "OWNER",
      targetId: "owner",
    }).ok, false);
    assert.equal(planMemberRemoval({
      actorRole: "OWNER",
      actorId: "owner",
      targetRole: "OWNER",
      targetId: "owner",
    }).ok, false);
    assert.equal(membersShareWorkspace({
      workspaceMemberIds: ["a", "b"],
      requiredUserIds: ["a", "c"],
    }).ok, false);
    assert.equal(normalizeWorkspaceName("  Haddad family "), "Haddad family");
    assert.equal(normalizeWorkspaceName("حداد"), "حداد");
    assert.equal(normalizeWorkspaceName("a"), null);
  });
});

describe("billing providers", () => {
  it("does not call Stripe when billing is off or the mock adapter is selected", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error("network");
    };
    const disabled = selectBillingProvider({
      enabled: false,
      provider: "stripe",
      stripeSecretKey: "sk_live_should_not_be_used",
      prices: { TEAM: "price_team" },
      fetchImpl,
    });
    assert.equal(disabled.id, "disabled");
    const off = await disabled.createCheckout({
      workspaceId: "ws",
      planId: "TEAM",
      seatQuantity: 3,
      customerEmail: "ada@example.com",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/cancel",
    });
    assert.equal(off.ok, false);
    if (!off.ok) assert.equal(off.code, "billing_disabled");
    const mock = await createMockBilling().createCheckout({
      workspaceId: "ws",
      planId: "TEAM",
      seatQuantity: 3,
      customerEmail: "ada@example.com",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/cancel",
    });
    assert.equal(mock.ok, true);
    if (mock.ok) {
      assert.equal(mock.status, "active");
      assert.equal(mock.checkoutUrl, null);
    }
    const unconfigured = await createStripeBilling({
      prices: {},
      fetchImpl,
    }).createCheckout({
      workspaceId: "ws",
      planId: "TEAM",
      seatQuantity: 3,
      customerEmail: "ada@example.com",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/cancel",
    });
    assert.equal(unconfigured.ok, false);
    assert.equal(calls, 0);
    assert.equal(disabledBilling.id, "disabled");
  });

  it("builds a Stripe checkout request without putting the secret in the body", async () => {
    const secret = "sk_test_example";
    let seenUrl = "";
    let seenAuth = "";
    let seenBody = "";
    const fetchImpl: typeof fetch = async (url, init) => {
      seenUrl = String(url);
      seenAuth = new Headers(init?.headers).get("Authorization") ?? "";
      seenBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const result = await createStripeBilling({
      secretKey: secret,
      prices: { TEAM: "price_team", FAMILY_PLUS: "price_plus" },
      fetchImpl,
    }).createCheckout({
      workspaceId: "ws-1",
      planId: "TEAM",
      seatQuantity: 4,
      customerEmail: "ada@example.com",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/cancel",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.status, "incomplete");
    assert.equal(seenUrl, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(seenAuth, `Bearer ${secret}`);
    assert.equal(seenBody.includes(secret), false);
    assert.equal(seenBody.includes("price_team"), true);
    assert.equal(seenBody.includes("seat"), false);
    const form = stripeCheckoutForm({
      workspaceId: "ws-1",
      planId: "FAMILY_PLUS",
      seatQuantity: 1,
      customerEmail: "ada@example.com",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/cancel",
      priceId: "price_plus",
    });
    assert.equal(form.get("metadata[planId]"), "FAMILY_PLUS");
  });

  it("checks Stripe signatures and reads the workspace id from the event", () => {
    const secret = "whsec_test";
    const raw = JSON.stringify({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { workspaceId: "ws-1", planId: "TEAM" },
          customer: "cus_123",
          subscription: "sub_123",
        },
      },
    });
    const stamp = 1_700_000_000;
    const signature = createHmac("sha256", secret).update(`${stamp}.${raw}`).digest("hex");
    assert.equal(verifyStripeSignature({
      rawBody: raw,
      header: `t=${stamp},v1=${signature}`,
      secret,
      nowSec: stamp,
    }), true);
    assert.equal(verifyStripeSignature({
      rawBody: raw,
      header: `t=${stamp},v1=${signature}`,
      secret,
      nowSec: stamp + 301,
    }), false);
    const event = interpretStripeEvent(JSON.parse(raw));
    assert.equal(event.type, "activated");
    if (event.type === "activated") {
      assert.equal(event.workspaceId, "ws-1");
      assert.equal(event.planId, "TEAM");
    }
    assert.equal(interpretStripeEvent({
      type: "customer.subscription.deleted",
      data: { object: { metadata: { workspaceId: "ws-1" } } },
    }).type, "canceled");
  });
});

describe("design partner waitlist", () => {
  it("accepts an email and a short note", () => {
    const parsed = designPartnerSchema.safeParse({
      email: "Ada@Example.com",
      locale: "ar",
      note: "Family of six",
    });
    assert.equal(parsed.success, true);
    assert.equal(designPartnerSchema.safeParse({ email: "not-an-email" }).success, false);
    assert.equal(designPartnerSchema.safeParse({
      email: "ada@example.com",
      note: "x".repeat(281),
    }).success, false);
  });
});

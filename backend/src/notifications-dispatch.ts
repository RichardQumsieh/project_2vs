import { prisma } from "./db.js";
import { env } from "./env.js";
import {
  planNotifications,
  type PushPlatform,
  type RecipientSnapshot,
} from "./notifications-policy.js";
import { defaultWebPushSender, sendExpoPush, sendWebPush } from "./push-delivery.js";

const PRESENCE_MS = 45_000;

function asPlatform(value: string): PushPlatform | null {
  if (value === "ios" || value === "android" || value === "web") return value;
  return null;
}

function webKeys(value: unknown): { endpoint?: string; p256dh?: string; auth?: string } {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    endpoint: typeof record.endpoint === "string" ? record.endpoint : undefined,
    p256dh: typeof record.p256dh === "string" ? record.p256dh : undefined,
    auth: typeof record.auth === "string" ? record.auth : undefined,
  };
}

export async function dispatchPush(input: {
  conversationId: string;
  senderUserId: string;
  recipientUserIds: string[];
  kind: "message" | "call";
  call?: { callId: string; mode: "audio" | "video"; scope: "direct" | "group" };
  fetchImpl?: typeof fetch;
}): Promise<{ deliveries: number }> {
  const ids = [...new Set(input.recipientUserIds)].filter((id) => id && id !== input.senderUserId);
  if (ids.length === 0) return { deliveries: 0 };
  const now = new Date();
  const [devices, prefs, mutes, states] = await Promise.all([
    prisma.pushDevice.findMany({
      where: { userId: { in: ids }, revokedAt: null },
    }),
    prisma.notificationPreference.findMany({ where: { userId: { in: ids } } }),
    prisma.conversationMute.findMany({
      where: { userId: { in: ids }, conversationId: input.conversationId },
    }),
    prisma.notificationState.findMany({ where: { userId: { in: ids } } }),
  ]);
  const recipients: RecipientSnapshot[] = ids.map((userId) => {
    const pref = prefs.find((item) => item.userId === userId);
    const mute = mutes.find((item) => item.userId === userId);
    const state = states.find((item) => item.userId === userId);
    return {
      userId,
      hidePreviews: pref?.hidePreviews ?? true,
      badgeCount: state?.badgeCount ?? 0,
      muteExists: Boolean(mute),
      mutedUntil: mute?.mutedUntil ?? null,
      openConversationId: state?.openConversationId ?? null,
      openUntil: state?.openUntil ?? null,
      foregroundUntil: state?.foregroundUntil ?? null,
      devices: devices.flatMap((device) => {
        if (device.userId !== userId) return [];
        const platform = asPlatform(device.platform);
        if (!platform) return [];
        const keys = webKeys(device.keys);
        return [{
          platform,
          token: device.token,
          endpoint: keys.endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        }];
      }),
    };
  });
  const plan = planNotifications({
    recipients,
    senderUserId: input.senderUserId,
    conversationId: input.conversationId,
    now,
    kind: input.kind,
    call: input.call,
  });
  await Promise.all(plan.badgeUpdates.map((update) => prisma.notificationState.upsert({
    where: { userId: update.userId },
    create: { userId: update.userId, badgeCount: update.badge },
    update: { badgeCount: update.badge },
  })));
  const expo = await sendExpoPush(plan.deliveries, input.fetchImpl);
  let dropTokens = expo.dropTokens;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT) {
    const web = await sendWebPush(plan.deliveries, (delivery) => defaultWebPushSender({
      ...delivery,
      subject: env.VAPID_SUBJECT!,
      publicKey: env.VAPID_PUBLIC_KEY!,
      privateKey: env.VAPID_PRIVATE_KEY!,
    }));
    dropTokens = dropTokens.concat(web.dropTokens);
  }
  if (dropTokens.length > 0) {
    await prisma.pushDevice.updateMany({
      where: { token: { in: dropTokens } },
      data: { revokedAt: now },
    });
  }
  return { deliveries: plan.deliveries.length };
}

export function presenceExpiry(now = new Date()): Date {
  return new Date(now.getTime() + PRESENCE_MS);
}

export async function queueMessagePush(input: {
  conversationId: string;
  senderUserId: string;
  recipientUserIds: string[];
}): Promise<void> {
  await dispatchPush({ ...input, kind: "message" }).catch(() => undefined);
}

export async function queueCallPush(input: {
  conversationId: string;
  senderUserId: string;
  recipientUserIds: string[];
  callId: string;
  mode: "audio" | "video";
  scope: "direct" | "group";
}): Promise<void> {
  await dispatchPush({
    conversationId: input.conversationId,
    senderUserId: input.senderUserId,
    recipientUserIds: input.recipientUserIds,
    kind: "call",
    call: { callId: input.callId, mode: input.mode, scope: input.scope },
  }).catch(() => undefined);
}

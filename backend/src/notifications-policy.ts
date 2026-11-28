/** E2EE-safe push planning. Payloads carry ids only. Visible text is a fixed template. */

export const MESSAGE_TITLE = "New message";
export const CALL_TITLE = "Incoming call";

export type PushPlatform = "ios" | "android" | "web";

export type PushDeviceSnapshot = {
  platform: PushPlatform;
  token: string;
  endpoint?: string;
  p256dh?: string;
  auth?: string;
};

export type RecipientSnapshot = {
  userId: string;
  hidePreviews: boolean;
  badgeCount: number;
  muteExists: boolean;
  mutedUntil: Date | null;
  openConversationId: string | null;
  openUntil: Date | null;
  foregroundUntil: Date | null;
  devices: PushDeviceSnapshot[];
};

export type PushKind = "message" | "call";

export type PushPayload = {
  kind: PushKind;
  conversationId: string;
  senderId: string;
  callId?: string;
  mode?: "audio" | "video";
  scope?: "direct" | "group";
};

export type PlannedDelivery = {
  userId: string;
  platform: PushPlatform;
  token: string;
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  payload: PushPayload;
  title: string | null;
  body: string | null;
  badge: number | null;
  channelId: "messages" | "calls";
  collapseKey: string;
  ttlSeconds: number;
  priority: "high";
};

export type NotificationPlan = {
  deliveries: PlannedDelivery[];
  badgeUpdates: { userId: string; badge: number }[];
  skipped: { userId: string; reason: "self" | "muted" | "open" | "foreground" | "no-device" }[];
};

const MESSAGE_KEYS = ["kind", "conversationId", "senderId"] as const;
const CALL_KEYS = ["kind", "conversationId", "senderId", "callId", "mode", "scope"] as const;

export function isMuted(recipient: Pick<RecipientSnapshot, "muteExists" | "mutedUntil">, now: Date): boolean {
  if (!recipient.muteExists) return false;
  if (!recipient.mutedUntil) return true;
  return recipient.mutedUntil.getTime() > now.getTime();
}

export function isConversationOpen(
  recipient: Pick<RecipientSnapshot, "openConversationId" | "openUntil">,
  conversationId: string,
  now: Date,
): boolean {
  return Boolean(
    recipient.openConversationId === conversationId &&
    recipient.openUntil &&
    recipient.openUntil.getTime() > now.getTime(),
  );
}

export function isForeground(recipient: Pick<RecipientSnapshot, "foregroundUntil">, now: Date): boolean {
  return Boolean(recipient.foregroundUntil && recipient.foregroundUntil.getTime() > now.getTime());
}

export function messagePayload(conversationId: string, senderId: string): PushPayload {
  return { kind: "message", conversationId, senderId };
}

export function callPayload(input: {
  conversationId: string;
  senderId: string;
  callId: string;
  mode: "audio" | "video";
  scope: "direct" | "group";
}): PushPayload {
  return {
    kind: "call",
    conversationId: input.conversationId,
    senderId: input.senderId,
    callId: input.callId,
    mode: input.mode,
    scope: input.scope,
  };
}

export function payloadKeys(payload: PushPayload): string[] {
  return Object.keys(payload).sort();
}

export function payloadIsSafe(payload: PushPayload): boolean {
  const keys = payloadKeys(payload);
  const allowed = payload.kind === "call" ? [...CALL_KEYS].sort() : [...MESSAGE_KEYS].sort();
  if (keys.join(",") !== allowed.join(",")) return false;
  const values = Object.values(payload);
  return values.every((value) => typeof value === "string" && value.length > 0 && value.length <= 80);
}

export function nextBadge(current: number): number {
  if (!Number.isFinite(current) || current < 0) return 1;
  return Math.min(99, Math.floor(current) + 1);
}

export function planNotifications(input: {
  recipients: RecipientSnapshot[];
  senderUserId: string;
  conversationId: string;
  now: Date;
  kind: PushKind;
  call?: { callId: string; mode: "audio" | "video"; scope: "direct" | "group" };
}): NotificationPlan {
  const deliveries: PlannedDelivery[] = [];
  const badgeUpdates: { userId: string; badge: number }[] = [];
  const skipped: NotificationPlan["skipped"] = [];
  for (const recipient of input.recipients) {
    if (recipient.userId === input.senderUserId) {
      skipped.push({ userId: recipient.userId, reason: "self" });
      continue;
    }
    if (isMuted(recipient, input.now)) {
      skipped.push({ userId: recipient.userId, reason: "muted" });
      continue;
    }
    if (input.kind === "message" && isConversationOpen(recipient, input.conversationId, input.now)) {
      skipped.push({ userId: recipient.userId, reason: "open" });
      continue;
    }
    if (input.kind === "call" && isForeground(recipient, input.now)) {
      skipped.push({ userId: recipient.userId, reason: "foreground" });
      continue;
    }
    if (recipient.devices.length === 0) {
      skipped.push({ userId: recipient.userId, reason: "no-device" });
      continue;
    }
    const payload = input.kind === "call" && input.call
      ? callPayload({
          conversationId: input.conversationId,
          senderId: input.senderUserId,
          callId: input.call.callId,
          mode: input.call.mode,
          scope: input.call.scope,
        })
      : messagePayload(input.conversationId, input.senderUserId);
    const badge = input.kind === "message" ? nextBadge(recipient.badgeCount) : null;
    if (badge !== null) badgeUpdates.push({ userId: recipient.userId, badge });
    for (const device of recipient.devices) {
      deliveries.push({
        userId: recipient.userId,
        platform: device.platform,
        token: device.token,
        endpoint: device.endpoint,
        p256dh: device.p256dh,
        auth: device.auth,
        payload,
        title: input.kind === "call" ? null : MESSAGE_TITLE,
        body: input.kind === "call" ? null : MESSAGE_TITLE,
        badge,
        channelId: input.kind === "call" ? "calls" : "messages",
        collapseKey: input.conversationId,
        ttlSeconds: input.kind === "call" ? 30 : 86_400,
        priority: "high",
      });
    }
  }
  return { deliveries, badgeUpdates, skipped };
}

/**
 * What the device shows. The server never supplies a sender name or message body.
 * A preview is only attached by the client when it already decrypted the message
 * and the person has not hidden previews.
 */
export function notificationCopy(input: {
  hidePreviews: boolean;
  senderName?: string | null;
  decryptedPreview?: string | null;
  conversationOpen: boolean;
}): { show: boolean; title: string; body: string } {
  if (input.conversationOpen) return { show: false, title: MESSAGE_TITLE, body: MESSAGE_TITLE };
  if (input.hidePreviews || !input.senderName) {
    return { show: true, title: MESSAGE_TITLE, body: MESSAGE_TITLE };
  }
  const preview = input.decryptedPreview?.trim();
  return {
    show: true,
    title: input.senderName,
    body: preview ? preview.slice(0, 140) : MESSAGE_TITLE,
  };
}

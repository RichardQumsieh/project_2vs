import type { PlannedDelivery } from "./notifications-policy.js";

export type PushSendResult = {
  sent: number;
  failed: number;
  dropTokens: string[];
};

type ExpoTicket = { status?: string; details?: { error?: string } };

export function expoMessage(delivery: PlannedDelivery): Record<string, unknown> {
  const message: Record<string, unknown> = {
    to: delivery.token,
    data: delivery.payload,
    priority: delivery.priority,
    ttl: delivery.ttlSeconds,
    channelId: delivery.channelId,
  };
  if (delivery.title) message.title = delivery.title;
  if (delivery.body) message.body = delivery.body;
  if (delivery.badge !== null) message.badge = delivery.badge;
  if (delivery.channelId === "messages") message.categoryId = "message";
  if (delivery.channelId === "calls") message.categoryId = "incoming-call";
  return message;
}

export async function sendExpoPush(
  deliveries: PlannedDelivery[],
  fetchImpl: typeof fetch = fetch,
): Promise<PushSendResult> {
  const mobile = deliveries.filter((delivery) => delivery.platform === "ios" || delivery.platform === "android");
  if (mobile.length === 0) return { sent: 0, failed: 0, dropTokens: [] };
  const response = await fetchImpl("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mobile.map(expoMessage)),
  });
  if (!response.ok) return { sent: 0, failed: mobile.length, dropTokens: [] };
  const payload = await response.json() as { data?: ExpoTicket[] };
  const tickets = Array.isArray(payload.data) ? payload.data : [];
  const dropTokens: string[] = [];
  let sent = 0;
  let failed = 0;
  mobile.forEach((delivery, index) => {
    const ticket = tickets[index];
    if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      dropTokens.push(delivery.token);
      failed += 1;
      return;
    }
    if (ticket?.status === "error") {
      failed += 1;
      return;
    }
    sent += 1;
  });
  return { sent, failed, dropTokens };
}

export type WebPushSender = (input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  body: string;
  ttlSeconds: number;
  urgency: "high" | "normal";
}) => Promise<void>;

export async function sendWebPush(
  deliveries: PlannedDelivery[],
  sender: WebPushSender,
): Promise<PushSendResult> {
  const web = deliveries.filter((delivery) => delivery.platform === "web" && delivery.endpoint && delivery.p256dh && delivery.auth);
  let sent = 0;
  let failed = 0;
  const dropTokens: string[] = [];
  for (const delivery of web) {
    try {
      await sender({
        endpoint: delivery.endpoint!,
        p256dh: delivery.p256dh!,
        auth: delivery.auth!,
        body: JSON.stringify(delivery.payload),
        ttlSeconds: delivery.ttlSeconds,
        urgency: "high",
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      const status = typeof error === "object" && error && "statusCode" in error
        ? Number((error as { statusCode?: number }).statusCode)
        : 0;
      if (status === 404 || status === 410) dropTokens.push(delivery.token);
    }
  }
  return { sent, failed, dropTokens };
}

export async function defaultWebPushSender(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  body: string;
  ttlSeconds: number;
  urgency: "high" | "normal";
  subject: string;
  publicKey: string;
  privateKey: string;
}): Promise<void> {
  const imported = await import("web-push");
  const webpush = imported.default;
  webpush.setVapidDetails(input.subject, input.publicKey, input.privateKey);
  await webpush.sendNotification(
    {
      endpoint: input.endpoint,
      keys: { p256dh: input.p256dh, auth: input.auth },
    },
    input.body,
    { TTL: input.ttlSeconds, urgency: input.urgency },
  );
}

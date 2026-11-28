import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { notificationCopy } from "../../frontend/lib/notifications/presentation";
import { presentIncomingCall } from "./call-native";

export const BACKGROUND_NOTIFICATION_TASK = "sophia-background-notification";

let openConversationId: string | null = null;
let hidePreviews = true;
const senderNames: Record<string, string> = {};

export function setNotificationPrivacy(next: { hidePreviews?: boolean; openConversationId?: string | null; senderName?: { id: string; name: string } }) {
  if (typeof next.hidePreviews === "boolean") hidePreviews = next.hidePreviews;
  if ("openConversationId" in next) openConversationId = next.openConversationId ?? null;
  if (next.senderName) senderNames[next.senderName.id] = next.senderName.name;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as { conversationId?: string; senderId?: string; kind?: string };
    const copy = notificationCopy({
      hidePreviews,
      senderName: data.senderId ? senderNames[data.senderId] : null,
      conversationOpen: Boolean(data.conversationId && data.conversationId === openConversationId),
    });
    return {
      shouldShowBanner: copy.show && data.kind !== "call",
      shouldShowList: copy.show && data.kind !== "call",
      shouldPlaySound: copy.show,
      shouldSetBadge: data.kind !== "call",
    };
  },
});

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data }) => {
  const notification = (data as { notification?: { data?: Record<string, unknown> } } | undefined)?.notification;
  const payload = notification?.data;
  if (!payload || payload.kind !== "call") return;
  const callId = typeof payload.callId === "string" ? payload.callId : "";
  const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : "";
  if (!callId || !conversationId) return;
  await presentIncomingCall({
    callId,
    conversationId,
    mode: payload.mode === "video" ? "video" : "audio",
    scope: payload.scope === "group" ? "group" : "direct",
    appState: "background",
  });
});

export async function registerBackgroundNotifications() {
  try {
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  } catch {
    // Background delivery still works through the system notification when the task cannot register.
  }
}

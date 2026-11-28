import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

const projectId = "447dd9a5-8bfd-4026-aeef-6c5fbee8dba6";
let currentToken: string | null = null;

export function currentPushToken() {
  return currentToken;
}

export async function registerPushToken(cookie: string) {
  const existing = await Notifications.getPermissionsAsync();
  if (!existing.granted) {
    const asked = await Notifications.requestPermissionsAsync();
    if (!asked.granted) return null;
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("messages", {
      name: "Messages",
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync("calls", {
      name: "Calls",
      importance: Notifications.AndroidImportance.MAX,
      bypassDnd: true,
      sound: "default",
      vibrationPattern: [0, 700, 500, 700],
    });
    await Notifications.setNotificationCategoryAsync("message", [
      {
        identifier: "reply",
        buttonTitle: "Reply",
        textInput: { submitButtonTitle: "Send", placeholder: "Message" },
        options: { opensAppToForeground: true },
      },
    ]);
  }
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  currentToken = token.data;
  await api.registerPushDevice({ platform: Platform.OS === "ios" ? "ios" : "android", token: token.data }, cookie);
  return token.data;
}

export async function registerPushIfGranted(cookie: string) {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (!existing.granted) return null;
    return await registerPushToken(cookie);
  } catch {
    return null;
  }
}

import React, { useEffect, useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";
import { api } from "./api";
import { sophiaCall } from "./call-native";
import { registerPushToken } from "./push-registration";
import { ActionButton, Card, Notice } from "./ui";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function NotificationSettings({ cookie }: { cookie: string }) {
  const [hidePreviews, setHidePreviews] = useState(true);
  const [conversationId, setConversationId] = useState("");
  const [fullScreen, setFullScreen] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.notificationSettings(cookie).then((settings) => setHidePreviews(settings.hidePreviews)).catch((cause) => setError(message(cause)));
    void sophiaCall()?.canUseFullScreenIntent().then(setFullScreen).catch(() => setFullScreen(null));
  }, [cookie]);

  return <View style={{ padding: 16, gap: 12 }}>
    <Text style={{ fontSize: 22 }}>Notifications</Text>
    <Text>Sophia alerts you when a message or call arrives. The server sends a conversation id and a sender id, never the message text. A preview is shown only on this device when you allow it and the chat is already unlocked.</Text>
    <Text>Incoming calls use a full-screen Android alert with a ringtone, even on the lock screen. Sophia does not ask to draw over other apps.</Text>
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Text style={{ flex: 1 }}>Hide sender names and previews</Text>
        <Switch value={hidePreviews} onValueChange={(value) => {
          setHidePreviews(value);
          void api.saveNotificationSettings(value, cookie).catch((cause) => setError(message(cause)));
        }} />
      </View>
    </Card>
    <ActionButton title="Enable notifications" busy={busy} onPress={() => {
      setBusy(true);
      void registerPushToken(cookie).then((token) => setNotice(token ? "Notifications are on for this device." : "Notification permission was not granted."))
        .catch((cause) => setError(message(cause)))
        .finally(() => setBusy(false));
    }} />
    {fullScreen === false ? <ActionButton title="Allow full-screen calls" secondary onPress={() => sophiaCall()?.openFullScreenSettings()} /> : null}
    <TextInput value={conversationId} onChangeText={setConversationId} placeholder="Conversation id to mute" style={{ borderWidth: 1, borderRadius: 12, padding: 10 }} />
    <ActionButton title="Mute chat" secondary onPress={() => void api.setConversationMute(conversationId.trim(), true, cookie).then(() => setNotice("Muted.")).catch((cause) => setError(message(cause)))} />
    {!!error && <Notice text={error} />}
    {!!notice && <Notice text={notice} tone="success" />}
  </View>;
}

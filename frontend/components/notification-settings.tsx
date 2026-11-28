"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useI18n } from "@/lib/i18n/locale";
import { createWebPushSubscription, forgetWebPushToken, rememberWebPushToken, storedWebPushToken } from "@/lib/notifications/web-push";

function message(error: unknown) {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

export function NotificationSettings() {
  const { t } = useI18n();
  const [hidePreviews, setHidePreviews] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [devices, setDevices] = useState(0);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.notificationSettings().then((settings) => {
      setHidePreviews(settings.hidePreviews);
      setConfigured(settings.webPushConfigured);
      setDevices(settings.devices);
      setPublicKey(settings.vapidPublicKey);
    }).catch((cause) => setError(message(cause)));
  }, []);

  async function savePrivacy(next: boolean) {
    setHidePreviews(next);
    setError("");
    try {
      await api.saveNotificationSettings(next);
      setNotice(t("notifications.saved"));
    } catch (cause) {
      setError(message(cause));
    }
  }

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setError("");
    try {
      const subscription = await createWebPushSubscription(publicKey);
      if (!subscription) {
        setError(t("notifications.permission"));
        return;
      }
      await api.registerPushDevice({ platform: "web", token: subscription.token, keys: subscription.keys });
      rememberWebPushToken(subscription.token);
      setDevices((count) => count + 1);
      setNotice(t("notifications.enabled"));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    const token = storedWebPushToken();
    setBusy(true);
    setError("");
    try {
      if (token) await api.unregisterPushDevice(token);
      forgetWebPushToken();
      setNotice(t("notifications.disabled"));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function mute(muted: boolean) {
    setError("");
    try {
      await api.setConversationMute(conversationId.trim(), { muted, mutedUntil: null });
      setNotice(muted ? t("notifications.muted") : t("notifications.unmuted"));
    } catch (cause) {
      setError(message(cause));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/70">{t("notifications.explain")}</p>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={hidePreviews} onChange={(event) => void savePrivacy(event.target.checked)} />
        {t("notifications.hide")}
      </label>
      <p className="text-xs text-white/50">{configured ? t("notifications.ready") : t("notifications.unconfigured")} · {devices}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-full bg-white px-4 py-2 text-sm text-black" disabled={!configured || busy} onClick={() => void enable()}>{t("notifications.enable")}</button>
        <button type="button" className="rounded-full border border-white/20 px-4 py-2 text-sm" disabled={busy} onClick={() => void disable()}>{t("notifications.disable")}</button>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void mute(true); }}>
        <input value={conversationId} onChange={(event) => setConversationId(event.target.value)} placeholder={t("themes.chatPrompt")} className="h-11 min-w-64 flex-1 rounded-2xl border border-white/10 bg-black/20 px-3" />
        <button type="submit" className="rounded-full border border-white/20 px-4">{t("notifications.mute")}</button>
        <button type="button" className="rounded-full border border-white/20 px-4" onClick={() => void mute(false)}>{t("notifications.unmute")}</button>
      </form>
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-emerald-100">{notice}</p> : null}
    </div>
  );
}

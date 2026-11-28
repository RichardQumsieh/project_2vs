function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function createWebPushSubscription(publicKey: string): Promise<{
  token: string;
  keys: { endpoint: string; p256dh: string; auth: string };
} | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return null;
  return {
    token: json.endpoint,
    keys: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

export function rememberWebPushToken(token: string) {
  try {
    window.localStorage.setItem("sophia-web-push", token);
  } catch {
    // Storage can be blocked. Sign-out still asks the server to drop the last token we have.
  }
}

export function storedWebPushToken(): string | null {
  try {
    return window.localStorage.getItem("sophia-web-push");
  } catch {
    return null;
  }
}

export function forgetWebPushToken() {
  try {
    window.localStorage.removeItem("sophia-web-push");
  } catch {
    // Ignore.
  }
}

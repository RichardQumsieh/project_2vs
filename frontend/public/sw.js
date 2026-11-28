self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  event.respondWith(fetch(request));
});

function pushData(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const data = pushData(event) || {};
  const kind = data.kind === "call" ? "call" : "message";
  const conversationId = typeof data.conversationId === "string" ? data.conversationId : "";
  const title = kind === "call" ? "Incoming call" : "New message";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const focusedHere = windows.some((client) => client.focused && conversationId && client.url.includes(conversationId));
    if (focusedHere && kind === "message") return;
    await self.registration.showNotification(title, {
      body: title,
      tag: kind === "call" && data.callId ? `call:${data.callId}` : conversationId || "sophia",
      renotify: true,
      requireInteraction: kind === "call",
      data,
      actions: kind === "call"
        ? [
            { action: "accept", title: "Accept" },
            { action: "decline", title: "Decline" },
          ]
        : [{ action: "open", title: "Open" }],
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const conversationId = typeof data.conversationId === "string" ? data.conversationId : "";
  const target = conversationId ? `/inbox/${conversationId}` : "/inbox";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((item) => "focus" in item) || null;
    if (client) {
      await client.focus();
      const callAction = event.action === "accept" || event.action === "decline";
      client.postMessage(data.kind === "call" && callAction
        ? { type: "sophia-call-action", action: event.action, callId: data.callId, conversationId }
        : data.kind === "call"
          ? { type: "sophia-open-call", callId: data.callId, conversationId }
          : { type: "sophia-open-chat", conversationId });
      if ("navigate" in client && conversationId) {
        try { await client.navigate(target); } catch { /* The focused client opens the chat from the message. */ }
      }
      return;
    }
    await self.clients.openWindow(target);
  })());
});

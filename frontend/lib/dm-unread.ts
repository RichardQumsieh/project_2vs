const userIdPattern = /^[A-Za-z0-9_-]{1,80}$/;

export type DmUnreadMap = Record<string, number>;

export function dmUnreadStorageKey(userId: string): string {
  const safe = userId && userIdPattern.test(userId) ? userId : "device";
  return `sophia-dm-unread:v1:${safe}`;
}

export function loadDmUnread(userId: string, storage: Storage | null = defaultStorage()): DmUnreadMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(dmUnreadStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DmUnreadMap = {};
    for (const [id, count] of Object.entries(parsed)) {
      if (typeof id !== "string" || id.length > 80) continue;
      if (typeof count !== "number" || !Number.isFinite(count) || count < 1) continue;
      out[id] = Math.min(99, Math.floor(count));
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDmUnread(
  userId: string,
  map: DmUnreadMap,
  storage: Storage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    const compact: DmUnreadMap = {};
    for (const [id, count] of Object.entries(map)) {
      if (count > 0) compact[id] = Math.min(99, Math.floor(count));
    }
    if (Object.keys(compact).length === 0) {
      storage.removeItem(dmUnreadStorageKey(userId));
      return;
    }
    storage.setItem(dmUnreadStorageKey(userId), JSON.stringify(compact));
  } catch {
    // Quota or private mode — unread badges are best-effort.
  }
}

export function bumpDmUnread(
  map: DmUnreadMap,
  conversationId: string,
  by = 1,
): DmUnreadMap {
  const next = { ...map };
  next[conversationId] = Math.min(99, (next[conversationId] ?? 0) + Math.max(1, by));
  return next;
}

export function clearDmUnread(map: DmUnreadMap, conversationId: string): DmUnreadMap {
  if (!(conversationId in map)) return map;
  const next = { ...map };
  delete next[conversationId];
  return next;
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

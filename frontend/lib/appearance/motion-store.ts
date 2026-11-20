import type { ThemeMotion } from "./theme-requests";
import { sanitizeUserId } from "./store";

export function motionStorageKey(userId: string): string {
  return `sophia-theme-motion:v1:${sanitizeUserId(userId)}`;
}

export function loadThemeMotion(
  userId: string,
  storage: Storage | null = defaultStorage(),
): ThemeMotion {
  if (!storage) return { kind: "none" };
  try {
    const raw = storage.getItem(motionStorageKey(userId));
    if (!raw) return { kind: "none" };
    const parsed = JSON.parse(raw) as ThemeMotion;
    if (!parsed || typeof parsed !== "object") return { kind: "none" };
    if (parsed.kind === "none") return { kind: "none" };
    if (
      parsed.kind === "rotate" &&
      typeof parsed.intervalMs === "number" &&
      Array.isArray(parsed.frames) &&
      parsed.frames.length > 0
    ) {
      return {
        kind: "rotate",
        intervalMs: Math.min(120_000, Math.max(3_000, parsed.intervalMs)),
        frames: parsed.frames,
      };
    }
    return { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

export function saveThemeMotion(
  userId: string,
  motion: ThemeMotion,
  storage: Storage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (motion.kind === "none") {
      storage.removeItem(motionStorageKey(userId));
      return;
    }
    storage.setItem(motionStorageKey(userId), JSON.stringify(motion));
  } catch {
    // ignore
  }
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

import { emptySafetyStore, parseSafetyStore, type SafetyStore } from "./safety-review";

const PREFIX = "sophia-safety-review:v1:";

export function safetyStorageKey(userId: string): string {
  return `${PREFIX}${encodeURIComponent(userId)}`;
}

export function readSafetyStore(userId: string): SafetyStore {
  if (typeof window === "undefined") return emptySafetyStore();
  try {
    return parseSafetyStore(window.localStorage.getItem(safetyStorageKey(userId)));
  } catch {
    return emptySafetyStore();
  }
}

export function writeSafetyStore(userId: string, store: SafetyStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(safetyStorageKey(userId), JSON.stringify(store));
  } catch {
    // Private mode can reject storage. The in-memory review still works for this view.
  }
}

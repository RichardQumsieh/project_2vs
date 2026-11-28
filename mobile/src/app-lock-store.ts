import * as SecureStore from "expo-secure-store";
import { parseLockDelayMs, setCurrentLockDelayMs, type LockDelayMs } from "./app-lock";

const KEY = "sophia.lockDelayMs";

export async function loadLockDelayMs(): Promise<LockDelayMs> {
  const value = await SecureStore.getItemAsync(KEY).catch(() => null);
  const delay = parseLockDelayMs(value);
  setCurrentLockDelayMs(delay);
  return delay;
}

export async function saveLockDelayMs(delay: LockDelayMs): Promise<void> {
  setCurrentLockDelayMs(delay);
  await SecureStore.setItemAsync(KEY, String(delay));
}

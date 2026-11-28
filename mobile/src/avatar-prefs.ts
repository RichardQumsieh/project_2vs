import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import type { AvatarPrefs } from "../../frontend/lib/avatar/greeting";

const STATIC_KEY = "sophia.staticAvatars";
const SPEAK_KEY = "sophia.speakGreetings";

let current: AvatarPrefs = { staticAvatars: false, speakGreetings: false };
const listeners = new Set<(prefs: AvatarPrefs) => void>();

function publish(next: AvatarPrefs) {
  current = next;
  for (const listener of listeners) listener(current);
}

export function currentAvatarPrefs() {
  return current;
}

export async function loadAvatarPrefs(): Promise<AvatarPrefs> {
  const [staticAvatars, speakGreetings] = await Promise.all([
    SecureStore.getItemAsync(STATIC_KEY).catch(() => null),
    SecureStore.getItemAsync(SPEAK_KEY).catch(() => null),
  ]);
  publish({
    staticAvatars: staticAvatars === "1",
    speakGreetings: speakGreetings === "1",
  });
  return current;
}

export async function saveAvatarPrefs(next: AvatarPrefs): Promise<void> {
  publish(next);
  await Promise.all([
    SecureStore.setItemAsync(STATIC_KEY, next.staticAvatars ? "1" : "0"),
    SecureStore.setItemAsync(SPEAK_KEY, next.speakGreetings ? "1" : "0"),
  ]);
}

export function useAvatarPrefs(): AvatarPrefs {
  const [prefs, setPrefs] = useState(current);
  useEffect(() => {
    listeners.add(setPrefs);
    void loadAvatarPrefs().catch(() => undefined);
    return () => {
      listeners.delete(setPrefs);
    };
  }, []);
  return prefs;
}

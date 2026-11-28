import type { AvatarPrefs } from "./greeting";

const STATIC_KEY = "sophia.staticAvatars";
const SPEAK_KEY = "sophia.speakGreetings";
const MOTION_KEY = "sophia-reduced-motion";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readReducedMotion(): boolean {
  const store = storage();
  const stored = store?.getItem(MOTION_KEY) === "on";
  const media = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return stored || media;
}

export function readAvatarPrefs(): AvatarPrefs {
  const store = storage();
  return {
    staticAvatars: store?.getItem(STATIC_KEY) === "1" || store?.getItem(MOTION_KEY) === "on",
    speakGreetings: store?.getItem(SPEAK_KEY) === "1",
  };
}

export function writeAvatarPrefs(prefs: AvatarPrefs) {
  const store = storage();
  if (!store) return;
  store.setItem(STATIC_KEY, prefs.staticAvatars ? "1" : "0");
  store.setItem(MOTION_KEY, prefs.staticAvatars ? "on" : "off");
  store.setItem(SPEAK_KEY, prefs.speakGreetings ? "1" : "0");
}

export function speakGreeting(text: string) {
  if (!text || typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 80));
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

import type { GreetingAnimation } from "./config";
import type { AvatarAnimation } from "./pose";

export type Entrance = {
  animation: AvatarAnimation;
  text: string | null;
  live: boolean;
};

export type EntranceInput = {
  contactId: string;
  conversationId?: string | null;
  isNew: boolean;
  hasAvatar: boolean;
  animation: GreetingAnimation | null;
  text: string | null;
};

export function createGreetingSession() {
  const opened = new Set<string>();
  const waved = new Set<string>();
  return {
    enter(input: EntranceInput): Entrance | null {
      const first = !opened.has(input.contactId);
      if (first) {
        opened.add(input.contactId);
        if (input.isNew && input.conversationId) waved.add(input.conversationId);
        if (!input.hasAvatar && !input.text) return null;
        const animation: AvatarAnimation = input.hasAvatar
          ? (input.animation ?? (input.isNew ? "subtleWave" : "wave"))
          : "idle";
        return { animation, text: input.text, live: input.hasAvatar && animation !== "idle" };
      }
      if (input.isNew && input.conversationId && !waved.has(input.conversationId)) {
        waved.add(input.conversationId);
        if (!input.hasAvatar) return null;
        return { animation: "subtleWave", text: null, live: true };
      }
      return null;
    },
  };
}

export type AvatarPrefs = {
  staticAvatars: boolean;
  speakGreetings: boolean;
};

export function prefersStaticAvatars(prefs: AvatarPrefs, reducedMotion: boolean): boolean {
  return prefs.staticAvatars || reducedMotion;
}

export function presentationMode(input: {
  focused: boolean;
  staticAvatars: boolean;
  glFailed: boolean;
}): "live" | "still" {
  if (!input.focused || input.staticAvatars || input.glFailed) return "still";
  return "live";
}

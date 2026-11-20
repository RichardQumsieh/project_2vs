import { z } from "zod";

export const VOICE_MANNERS = ["formal", "friendly"] as const;
export const VOICE_VERBOSITY = ["short", "detailed"] as const;
export const VOICE_LANGUAGES = ["english", "arabic", "mixed"] as const;

export type VoiceManner = (typeof VOICE_MANNERS)[number];
export type VoiceVerbosity = (typeof VOICE_VERBOSITY)[number];
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

export type VoicePreferences = {
  manner: VoiceManner;
  verbosity: VoiceVerbosity;
  language: VoiceLanguage;
};

export const defaultVoice: VoicePreferences = {
  manner: "friendly",
  verbosity: "detailed",
  language: "english",
};

export const voiceSchema = z
  .object({
    manner: z.enum(VOICE_MANNERS),
    verbosity: z.enum(VOICE_VERBOSITY),
    language: z.enum(VOICE_LANGUAGES),
  })
  .strict();

export function parseVoice(input: unknown): { ok: true; voice: VoicePreferences } | { ok: false } {
  const parsed = voiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  return { ok: true, voice: parsed.data };
}

/**
 * Instruction appended to on-device draft prompts.
 * It names the saved preference only. It does not include chat text.
 */
export function draftVoiceInstruction(voice: VoicePreferences): string {
  const manner =
    voice.manner === "formal"
      ? "Use a formal register. Avoid slang and exclamation marks."
      : "Use a friendly register. Stay respectful, and do not joke about serious topics.";
  const verbosity =
    voice.verbosity === "short"
      ? "Keep the draft short: one or two sentences."
      : "Write a detailed draft of a few sentences. Do not add facts you were not given.";
  const language =
    voice.language === "arabic"
      ? "Write the draft in Arabic."
      : voice.language === "mixed"
        ? "Write the draft in mixed Arabic and English."
        : "Write the draft in English.";
  return `Draft voice preference, chosen on this device: ${manner} ${verbosity} ${language}`;
}

function localizePurpose(purpose: string, language: VoiceLanguage): string {
  if (language === "english" || language === "mixed") return purpose;
  if (purpose === "align on next steps") return "تنسيق الخطوات التالية";
  if (purpose === "prepare the manager presentation") return "تجهيز عرض المدير";
  return purpose;
}

/**
 * Sophia-authored meeting draft. The default voice matches the historical
 * English template. Other voices are fixed phrases, not a remote translation.
 */
export function composeMeetingDraft(input: {
  purpose: string;
  when: string;
  voice?: VoicePreferences;
}): string {
  const voice = input.voice ?? defaultVoice;
  const purpose = input.purpose.replace(/\s+/g, " ").trim().slice(0, 160);
  const when = input.when.replace(/\s+/g, " ").trim().slice(0, 120);
  const parts = meetingParts(purpose, when, voice);
  const selected = voice.verbosity === "short" ? parts.slice(0, 2) : parts;
  return selected.join(" ").replace(/\s+/g, " ").trim().slice(0, 4_000);
}

function meetingParts(purpose: string, when: string, voice: VoicePreferences): string[] {
  if (voice.language === "arabic") {
    const localPurpose = localizePurpose(purpose, "arabic");
    const opener = voice.manner === "formal" ? "مرحبًا،" : "أهلًا،";
    const ask =
      voice.manner === "formal"
        ? `هل يناسبكم اجتماع ل${localPurpose}؟`
        : `فينا نجتمع ل${localPurpose}؟`;
    return [
      `${opener} ${ask}`,
      `الوقت المقترح: ${when}.`,
      "بشارك الأجندة ومنأكد المسؤولين بالاجتماع.",
    ];
  }
  if (voice.language === "mixed") {
    const opener = voice.manner === "formal" ? "Hello," : "Hi \u2014";
    return [
      `${opener} can we meet to ${purpose}?`,
      `الوقت المقترح: ${when}.`,
      "I'll share an agenda and we can confirm owners in the room.",
    ];
  }
  const opener = voice.manner === "formal" ? "Hello," : "Hi \u2014";
  return [
    `${opener} can we meet to ${purpose}?`,
    `Proposed timing: ${when}.`,
    "I'll share an agenda and we can confirm owners in the room.",
  ];
}

export function sameVoice(left: VoicePreferences, right: VoicePreferences): boolean {
  return (
    left.manner === right.manner &&
    left.verbosity === right.verbosity &&
    left.language === right.language
  );
}

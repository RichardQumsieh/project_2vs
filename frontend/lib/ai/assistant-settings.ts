import type { SummaryLanguage, SummaryTone } from "./types";
import type { CompanionMode } from "./companion-runtime";

export type VoiceMode = "silent" | "selected" | "automatic";

export type AssistantSettings = {
  enabled: boolean;
  language: SummaryLanguage;
  tone: SummaryTone;
  voiceMode: VoiceMode;
  voiceMuted: boolean;
  voiceURI: string;
  speechRate: number;
  companionMode: CompanionMode;
  proactiveObservations: boolean;
  automaticOnlineResearch: boolean;
  personalMemory: boolean;
  jarvisVoiceCommands: boolean;
  radarAnalysisEnabled: boolean;
};

export const defaultAssistantSettings: AssistantSettings = {
  enabled: false,
  language: "auto",
  tone: "concise",
  voiceMode: "silent",
  voiceMuted: false,
  voiceURI: "",
  speechRate: 1,
  companionMode: "interactive",
  proactiveObservations: true,
  automaticOnlineResearch: false,
  personalMemory: true,
  jarvisVoiceCommands: true,
  radarAnalysisEnabled: false,
};

const legacyStorageKey = "private-messenger:assistant-settings";

export function assistantSettingsStorageKey(userId: string) {
  return `${legacyStorageKey}:${userId}`;
}

export function parseAssistantSettings(value: unknown): AssistantSettings {
  if (typeof value !== "object" || value === null) {
    return defaultAssistantSettings;
  }

  const candidate = value as Record<string, unknown>;
  const speechRate =
    typeof candidate.speechRate === "number" &&
    Number.isFinite(candidate.speechRate)
      ? Math.min(1.3, Math.max(0.7, candidate.speechRate))
      : 1;

  return {
    enabled: candidate.enabled === true,
    language:
      candidate.language === "english" || candidate.language === "arabic"
        ? candidate.language
        : "auto",
    tone:
      candidate.tone === "professional" ||
      candidate.tone === "warm" ||
      candidate.tone === "playful"
        ? candidate.tone
        : "concise",
    voiceMode:
      candidate.voiceMode === "selected" ||
      candidate.voiceMode === "automatic"
        ? candidate.voiceMode
        : "silent",
    voiceMuted: candidate.voiceMuted === true,
    voiceURI:
      typeof candidate.voiceURI === "string"
        ? candidate.voiceURI.slice(0, 512)
        : "",
    speechRate,
    companionMode:
      candidate.companionMode === "quiet" ||
      candidate.companionMode === "active-voice"
        ? candidate.companionMode
        : "interactive",
    proactiveObservations: candidate.proactiveObservations !== false,
    automaticOnlineResearch: candidate.automaticOnlineResearch === true,
    personalMemory: candidate.personalMemory !== false,
    jarvisVoiceCommands: candidate.jarvisVoiceCommands !== false,
    radarAnalysisEnabled: candidate.radarAnalysisEnabled === true,
  };
}

export function loadAssistantSettings(userId?: string | null): AssistantSettings {
  if (typeof window === "undefined") {
    return defaultAssistantSettings;
  }
  try {
    if (userId) {
      const keyed = window.localStorage.getItem(
        assistantSettingsStorageKey(userId),
      );
      if (keyed) {
        return parseAssistantSettings(JSON.parse(keyed));
      }
      const legacy = window.localStorage.getItem(legacyStorageKey);
      if (legacy) {
        const migrated = parseAssistantSettings(JSON.parse(legacy));
        window.localStorage.setItem(
          assistantSettingsStorageKey(userId),
          JSON.stringify(migrated),
        );
        // Consume the shared legacy key so other accounts do not inherit it.
        window.localStorage.removeItem(legacyStorageKey);
        return migrated;
      }
      return defaultAssistantSettings;
    }
    const stored = window.localStorage.getItem(legacyStorageKey);
    return stored
      ? parseAssistantSettings(JSON.parse(stored))
      : defaultAssistantSettings;
  } catch {
    return defaultAssistantSettings;
  }
}

export function saveAssistantSettings(
  settings: AssistantSettings,
  userId?: string | null,
) {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const payload = JSON.stringify(settings);
    if (userId) {
      window.localStorage.setItem(
        assistantSettingsStorageKey(userId),
        payload,
      );
      return true;
    }
    window.localStorage.setItem(legacyStorageKey, payload);
    return true;
  } catch {
    return false;
  }
}

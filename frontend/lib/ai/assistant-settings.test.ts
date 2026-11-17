import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  assistantSettingsStorageKey,
  defaultAssistantSettings,
  loadAssistantSettings,
  parseAssistantSettings,
  saveAssistantSettings,
} from "./assistant-settings";

describe("on-device assistant preferences", () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => memory.get(key) ?? null,
          setItem: (key: string, value: string) => {
            memory.set(key, value);
          },
          removeItem: (key: string) => {
            memory.delete(key);
          },
        },
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("defaults suggestions to off until the user opts in", () => {
    expect(defaultAssistantSettings).toEqual({
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
      sophiaVoiceCommands: true,
      radarAnalysisEnabled: false,
    });
  });

  it("validates stored preferences and ignores malformed values", () => {
    expect(
      parseAssistantSettings({
        enabled: true,
        language: "arabic",
        tone: "professional",
        voiceMode: "automatic",
        voiceMuted: true,
        voiceURI: "local-ar",
        speechRate: 1.2,
        companionMode: "interactive",
        proactiveObservations: true,
        automaticOnlineResearch: false,
        personalMemory: true,
        sophiaVoiceCommands: true,
        radarAnalysisEnabled: true,
      }),
    ).toEqual({
      enabled: true,
      language: "arabic",
      tone: "professional",
      voiceMode: "automatic",
      voiceMuted: true,
      voiceURI: "local-ar",
      speechRate: 1.2,
      companionMode: "interactive",
      proactiveObservations: true,
      automaticOnlineResearch: false,
      personalMemory: true,
      sophiaVoiceCommands: true,
      radarAnalysisEnabled: true,
    });
    expect(parseAssistantSettings(null)).toEqual(defaultAssistantSettings);
    expect(
      parseAssistantSettings({
        enabled: true,
        language: "invalid",
        tone: "invalid",
      }),
    ).toEqual({
      enabled: true,
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
      sophiaVoiceCommands: true,
      radarAnalysisEnabled: false,
    });
  });

  it("stores preferences per user and migrates the legacy shared key once", () => {
    saveAssistantSettings(
      { ...defaultAssistantSettings, enabled: true },
      null,
    );
    const migrated = loadAssistantSettings("user-a");
    expect(migrated.enabled).toBe(true);
    expect(memory.has(assistantSettingsStorageKey("user-a"))).toBe(true);
    saveAssistantSettings(
      { ...defaultAssistantSettings, radarAnalysisEnabled: true },
      "user-a",
    );
    expect(loadAssistantSettings("user-b")).toEqual(defaultAssistantSettings);
    expect(loadAssistantSettings("user-a").radarAnalysisEnabled).toBe(true);
  });

  it("clamps invalid speech rates and ignores unknown voice modes", () => {
    expect(
      parseAssistantSettings({
        speechRate: 5,
        voiceMode: "unrecognized",
      }),
    ).toMatchObject({
      speechRate: 1.3,
      voiceMode: "silent",
    });
  });

  it("parses independent proactive, presence, and voice controls", () => {
    expect(
      parseAssistantSettings({
        enabled: true,
        companionMode: "active-voice",
        proactiveObservations: false,
        voiceMuted: true,
      }),
    ).toMatchObject({
      companionMode: "active-voice",
      proactiveObservations: false,
      voiceMuted: true,
    });
    expect(
      parseAssistantSettings({
        companionMode: "invalid",
        proactiveObservations: "yes",
      }),
    ).toMatchObject({
      companionMode: "interactive",
      proactiveObservations: true,
    });
  });

  it("keeps automatic online research off unless explicitly enabled", () => {
    expect(
      parseAssistantSettings({ automaticOnlineResearch: true })
        .automaticOnlineResearch,
    ).toBe(true);
    expect(
      parseAssistantSettings({ automaticOnlineResearch: "yes" })
        .automaticOnlineResearch,
    ).toBe(false);
  });

  it("keeps personal memory and Sophia voice commands on unless disabled", () => {
    expect(parseAssistantSettings({}).personalMemory).toBe(true);
    expect(
      parseAssistantSettings({ personalMemory: false }).personalMemory,
    ).toBe(false);
    expect(
      parseAssistantSettings({ sophiaVoiceCommands: false }).sophiaVoiceCommands,
    ).toBe(false);
  });

  it("keeps Radar analysis off unless explicitly enabled", () => {
    expect(parseAssistantSettings({}).radarAnalysisEnabled).toBe(false);
    expect(
      parseAssistantSettings({ radarAnalysisEnabled: true }).radarAnalysisEnabled,
    ).toBe(true);
    expect(
      parseAssistantSettings({ radarAnalysisEnabled: "yes" as never })
        .radarAnalysisEnabled,
    ).toBe(false);
  });
  it("migrates legacy jarvisVoiceCommands into sophiaVoiceCommands", () => {
    expect(
      parseAssistantSettings({ jarvisVoiceCommands: false } as never)
        .sophiaVoiceCommands,
    ).toBe(false);
    expect(
      parseAssistantSettings({ sophiaVoiceCommands: false }).sophiaVoiceCommands,
    ).toBe(false);
  });

});

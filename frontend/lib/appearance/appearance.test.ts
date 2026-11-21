import { describe, expect, it } from "vitest";
import { contrastRatio, TEXT_CONTRAST, UI_CONTRAST } from "./contrast";
import { curatedBackgroundsAreLocal } from "./backgrounds";
import { parseSignals, proposeAdaptation, topPanel } from "./engine";
import { adaptiveThemeEnabled } from "./flag";
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  parseAppearanceTokens,
} from "./schema";
import {
  approveProposal,
  createDefaultRecord,
  dismissProposal,
  draftVoiceForUser,
  loadAppearance,
  memoryStorage,
  recordPanelUse,
  resetAppearance,
  saveAppearance,
  syncProposal,
  undoAppearance,
  commitAppearance,
  activeTokens,
  activeVoice,
} from "./store";
import { eveningTokens, familyTokens, morningTokens } from "./tokens";
import { memoryUploads, validateUpload } from "./uploads";
import { composeMeetingDraft, defaultVoice, draftVoiceInstruction } from "./voice";
import { prepareCompanionPrompt } from "../ai/companion";
import { parseSophiaCommand } from "../ai/sophia-planner";
import { prepareSuggestionPrompt } from "../ai/suggestions";

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("appearance tokens", () => {
  it("accepts the built-in presets and rejects out-of-range values", () => {
    expect(parseAppearanceTokens(eveningTokens).ok).toBe(true);
    expect(parseAppearanceTokens(morningTokens).ok).toBe(true);
    expect(parseAppearanceTokens(familyTokens).ok).toBe(true);
    expect(parseAppearanceTokens({ ...eveningTokens, fontScale: FONT_SCALE_MIN }).ok).toBe(true);
    expect(parseAppearanceTokens({ ...eveningTokens, fontScale: FONT_SCALE_MAX }).ok).toBe(true);
    const tooBig = parseAppearanceTokens({ ...eveningTokens, fontScale: 1.4 });
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.issues[0]?.code).toBe("range");
    const offStep = parseAppearanceTokens({ ...eveningTokens, fontScale: 1.01 });
    expect(offStep.ok).toBe(false);
    const extra = parseAppearanceTokens({ ...eveningTokens, remote: "https://cdn.example/a.png" });
    expect(extra.ok).toBe(false);
  });

  it("rejects hotlinked backgrounds and accents that fail WCAG AA", () => {
    expect(
      parseAppearanceTokens({
        ...eveningTokens,
        background: { kind: "curated", id: "https://images.example/a.png" },
      }).ok,
    ).toBe(false);
    expect(
      parseAppearanceTokens({
        ...eveningTokens,
        background: { kind: "upload", id: "https://images.example/a.png" },
      }).ok,
    ).toBe(false);
    const muddy = parseAppearanceTokens({ ...morningTokens, accent: "#8a8f98" });
    expect(muddy.ok).toBe(false);
    if (!muddy.ok) {
      expect(muddy.issues.some((issue) => issue.code === "contrast")).toBe(true);
      expect(muddy.issues.find((issue) => issue.ratio !== undefined)?.required).toBeGreaterThanOrEqual(
        UI_CONTRAST,
      );
    }
    expect(contrastRatio("#f5f7fb", "#080d16")).toBeGreaterThan(TEXT_CONTRAST);
  });

  it("keeps curated backgrounds inside the bundle", () => {
    expect(curatedBackgroundsAreLocal()).toBe(true);
  });
});

describe("adaptive engine", () => {
  const now = new Date("2026-11-20T21:30:00.000Z");
  const signals = {
    locale: "en" as const,
    hour: 21,
    role: "manager" as const,
    panelUses: { inbox: 2, sophia: 0, settings: 0, integrations: 0 },
  };

  it("suggests a calmer evening theme without reading chat text", () => {
    const proposal = proposeAdaptation(
      activeTokens(createDefaultRecord(now)),
      defaultVoice,
      signals,
      [],
      now,
    );
    expect(proposal?.ruleId).toBe("evening-calm");
    expect(proposal?.voice).toMatchObject({ manner: "formal", verbosity: "short" });
    expect(proposal?.tokens.colorMode).toBe("dark");
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        walk(child);
      }
    };
    walk(proposal);
    expect([...keys]).not.toEqual(
      expect.arrayContaining(["plaintext", "body", "message", "query", "prompt"]),
    );
  });

  it("uses the clock, the chosen role, and panel counts", () => {
    const morning = proposeAdaptation(
      activeTokens(createDefaultRecord(now)),
      defaultVoice,
      { ...signals, hour: 9, panelUses: { inbox: 4, sophia: 1, settings: 0, integrations: 0 } },
      [],
      now,
    );
    expect(morning?.ruleId).toBe("morning-crisp");
    expect(topPanel(morning ? { inbox: 4, sophia: 1, settings: 0, integrations: 0 } : signals.panelUses)).toBe(
      "inbox",
    );
    const family = proposeAdaptation(
      activeTokens(createDefaultRecord(now)),
      defaultVoice,
      { ...signals, hour: 15, role: "family" },
      [],
      now,
    );
    expect(family?.ruleId).toBe("family-warm");
    expect(family?.voice.manner).toBe("friendly");
    const arabic = proposeAdaptation(
      activeTokens(createDefaultRecord(now)),
      defaultVoice,
      { ...signals, hour: 15, locale: "ar" },
      [],
      now,
    );
    expect(arabic?.ruleId).toBe("arabic-drafts");
    expect(arabic?.voice.language).toBe("arabic");
  });

  it("drops signals that carry chat text", () => {
    expect(parseSignals({ ...signals, plaintext: "meet at 9" })).toBeNull();
    expect(parseSignals({ ...signals, panelUses: { ...signals.panelUses, thread: "hello" } })).toBeNull();
  });

  it("does not repeat a dismissed suggestion inside the cooldown", () => {
    const record = createDefaultRecord(now);
    const synced = syncProposal(record, signals, now);
    expect(synced.pending?.ruleId).toBe("evening-calm");
    const dismissed = dismissProposal(synced, now);
    expect(dismissed.pending).toBeNull();
    const again = syncProposal(dismissed, signals, new Date(now.getTime() + 60_000));
    expect(again.pending).toBeNull();
  });
});

describe("appearance revisions", () => {
  const now = new Date("2026-11-20T21:30:00.000Z");

  it("approves, undoes, and resets without leaving the device", () => {
    const storage = memoryStorage();
    const fetchSpy = viFetch();
    let record = syncProposal(createDefaultRecord(now), {
      locale: "en",
      hour: 21,
      role: "manager",
      panelUses: { inbox: 1, sophia: 0, settings: 0, integrations: 0 },
    }, now);
    record = approveProposal(record, now);
    expect(activeTokens(record).colorMode).toBe("dark");
    expect(activeVoice(record).verbosity).toBe("short");
    expect(record.revisions.at(-1)?.source).toBe("proposal");
    record = undoAppearance(record);
    expect(activeTokens(record).colorMode).toBe("system");
    const edited = commitAppearance(record, morningTokens, { ...defaultVoice, manner: "formal" }, "user", now);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    record = resetAppearance(edited.record, now);
    expect(activeTokens(record)).toEqual(activeTokens(createDefaultRecord(now)));
    expect(activeVoice(record)).toEqual(defaultVoice);
    expect(saveAppearance("user-1", record, storage)).toBe(true);
    expect(loadAppearance("user-1", storage).role).toBe("manager");
    expect(loadAppearance("user-2", storage).revisions).toHaveLength(1);
    recordPanelUse("user-1", "sophia", storage);
    expect(recordPanelUse("user-1", "sophia", storage).sophia).toBe(2);
    expect(fetchSpy.calls).toBe(0);
    fetchSpy.restore();
  });

  it("keeps corrupt storage from applying a remote image", () => {
    const storage = memoryStorage({
      "sophia-appearance:v1:user-1": JSON.stringify({
        version: 1,
        role: "manager",
        revisions: [
          {
            id: "bad",
            at: now.toISOString(),
            source: "user",
            tokens: { ...eveningTokens, background: "https://cdn.example/bg.png" },
            voice: defaultVoice,
          },
        ],
        pending: null,
        decisions: [],
      }),
    });
    expect(activeTokens(loadAppearance("user-1", storage)).background).toEqual({ kind: "none" });
  });

  it("stores an uploaded image locally and rejects other bytes", async () => {
    const uploads = memoryUploads();
    const png = validateUpload({ mime: "image/png", bytes: ONE_PIXEL_PNG });
    expect(png.ok).toBe(true);
    if (!png.ok) return;
    await uploads.put({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      mime: png.mime,
      bytes: ONE_PIXEL_PNG,
      createdAt: now.toISOString(),
    });
    const stored = await uploads.get("user-1", "11111111-1111-4111-8111-111111111111");
    expect(stored?.bytes[0]).toBe(0x89);
    expect(validateUpload({ mime: "image/svg+xml", bytes: ONE_PIXEL_PNG }).ok).toBe(false);
    expect(validateUpload({ mime: "image/png", bytes: ONE_PIXEL_PNG.slice(0, 8) }).ok).toBe(false);
    const html = Uint8Array.from(Buffer.from("<html><script src='https://evil.example'></script></html>"));
    expect(validateUpload({ mime: "image/png", bytes: html }).ok).toBe(false);
  });
});

describe("draft voice", () => {
  it("keeps the historical meeting draft for the default voice", () => {
    expect(
      composeMeetingDraft({
        purpose: "align on next steps",
        when: "a time the team can do",
      }),
    ).toBe(
      "Hi \u2014 can we meet to align on next steps? Proposed timing: a time the team can do. I'll share an agenda and we can confirm owners in the room.",
    );
  });

  it("applies manner, length, and language on the device", () => {
    const arabic = composeMeetingDraft({
      purpose: "align on next steps",
      when: "Wednesday",
      voice: { manner: "formal", verbosity: "short", language: "arabic" },
    });
    expect(arabic).toMatch(/\p{Script=Arabic}/u);
    expect(arabic).not.toMatch(/I'll share an agenda/);
    expect(arabic.split(".").length).toBeLessThanOrEqual(3);
    const mixed = composeMeetingDraft({
      purpose: "align on next steps",
      when: "Wednesday",
      voice: { manner: "friendly", verbosity: "detailed", language: "mixed" },
    });
    expect(mixed).toMatch(/can we meet/);
    expect(mixed).toMatch(/الوقت المقترح/);
    const instruction = draftVoiceInstruction({
      manner: "formal",
      verbosity: "short",
      language: "english",
    });
    expect(instruction).toMatch(/formal/i);
    expect(instruction).not.toMatch(/plaintext|selected chat/i);
    const plan = parseSophiaCommand("Sophia organize a meeting", {
      voice: { manner: "formal", verbosity: "short", language: "arabic" },
    });
    const drafted = plan.intents.find((intent) => intent.type === "draft_message");
    expect(drafted?.type === "draft_message" && drafted.body).toMatch(/مرحبًا/);
    const voice = { manner: "formal" as const, verbosity: "short" as const, language: "english" as const };
    const withVoice = prepareCompanionPrompt({
      input: "Draft a reply",
      history: [],
      conversationId: "c",
      messages: [],
      useConversationContext: false,
      language: "english",
      tone: "concise",
      draftVoice: voice,
    });
    const withoutVoice = prepareCompanionPrompt({
      input: "Draft a reply",
      history: [],
      conversationId: "c",
      messages: [],
      useConversationContext: false,
      language: "english",
      tone: "concise",
    });
    expect(withVoice[0]?.content).toMatch(/Draft voice preference/);
    expect(withoutVoice[0]?.content).not.toMatch(/Draft voice preference/);
    const suggestion = prepareSuggestionPrompt({
      conversationId: "c",
      messages: [
        {
          id: "1",
          conversationId: "c",
          senderDeviceId: "device",
          fromMe: false,
          plaintext: "Can we move it?",
          createdAt: "2026-11-20T00:00:00.000Z",
        },
      ],
      language: "english",
      tone: "concise",
      draftVoice: voice,
    });
    expect(suggestion[0]?.content).toMatch(/Draft voice preference/);
  });

  it("leaves drafts alone while the feature flag is off", () => {
    const previous = process.env.NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED;
    try {
      delete process.env.NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED;
      expect(adaptiveThemeEnabled()).toBe(true);
      process.env.NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED = "false";
      expect(adaptiveThemeEnabled()).toBe(false);
      expect(draftVoiceForUser("user-1")).toBeUndefined();
      process.env.NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED = "true";
      expect(adaptiveThemeEnabled()).toBe(true);
      expect(draftVoiceForUser("user-1")).toEqual(defaultVoice);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED;
      else process.env.NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED = previous;
    }
  });
});

function viFetch() {
  const state = { calls: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    state.calls += 1;
    return Promise.reject(new Error("appearance must not use the network"));
  }) as typeof fetch;
  return {
    get calls() {
      return state.calls;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

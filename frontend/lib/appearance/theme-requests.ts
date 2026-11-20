import { assertAppearanceTokens, type AppearanceTokens } from "./schema";
import { defaultVoice, type VoicePreferences } from "./voice";

export type ThemeMotion =
  | { kind: "none" }
  | {
      kind: "rotate";
      intervalMs: number;
      frames: AppearanceTokens[];
    };

export type ThemeRequest = {
  label: string;
  tokens: AppearanceTokens;
  voice: VoicePreferences;
  motion: ThemeMotion;
  reply: string;
};

const spidermanTokens: AppearanceTokens = assertAppearanceTokens({
  colorMode: "dark",
  accent: "#e11d48",
  density: "comfortable",
  fontScale: 1,
  background: { kind: "gradient", id: "night" },
});

const natureFrames: AppearanceTokens[] = [
  assertAppearanceTokens({
    colorMode: "dark",
    accent: "#34d399",
    density: "comfortable",
    fontScale: 1,
    background: { kind: "gradient", id: "harbor" },
  }),
  assertAppearanceTokens({
    colorMode: "light",
    accent: "#2e7d32",
    density: "comfortable",
    fontScale: 1,
    background: { kind: "curated", id: "cedar" },
  }),
  assertAppearanceTokens({
    colorMode: "light",
    accent: "#0369a1",
    density: "comfortable",
    fontScale: 1,
    background: { kind: "curated", id: "tide" },
  }),
  assertAppearanceTokens({
    colorMode: "dark",
    accent: "#c9cff8",
    density: "comfortable",
    fontScale: 1,
    background: { kind: "gradient", id: "dusk" },
  }),
];

function parseIntervalMs(text: string): number {
  const match = text.match(
    /\bevery\s+(\d{1,3})\s*(seconds?|secs?|s|minutes?|mins?|m)\b/i,
  );
  if (!match?.[1] || !match[2]) return 10_000;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 1) return 10_000;
  const unit = match[2].toLowerCase();
  if (unit.startsWith("m")) return Math.min(120_000, Math.max(5_000, amount * 60_000));
  return Math.min(120_000, Math.max(3_000, amount * 1_000));
}

/** Map a natural-language theme ask to local tokens. No network. */
export function parseThemeRequest(input: string): ThemeRequest | null {
  const text = input.replace(/@?(?:sophia|jarvis)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > 500) return null;

  const wantsTheme =
    /\b(theme|appearance|look|skin|wallpaper|background)\b/i.test(text) ||
    /\b(spiderman|spider[\s-]?man)\b/i.test(text) ||
    /\bnature scenes?\b/i.test(text);
  if (!wantsTheme) return null;

  if (/\b(spiderman|spider[\s-]?man)\b/i.test(text)) {
    return {
      label: "spiderman",
      tokens: spidermanTokens,
      voice: defaultVoice,
      motion: { kind: "none" },
      reply: "Done — Spiderman theme is on (dark with a red accent).",
    };
  }

  if (
    /\bnature\b/i.test(text) ||
    /\b(forest|ocean|meadow|outdoors?)\b/i.test(text)
  ) {
    const intervalMs = parseIntervalMs(text);
    const rotating =
      /\bevery\b/i.test(text) ||
      /\brotat/i.test(text) ||
      /\bchang(e|es|ing)\b/i.test(text) ||
      /\bcycle\b/i.test(text);
    if (rotating) {
      return {
        label: "nature-rotate",
        tokens: natureFrames[0]!,
        voice: defaultVoice,
        motion: { kind: "rotate", intervalMs, frames: natureFrames },
        reply: `Done — nature scenes will rotate every ${Math.round(intervalMs / 1000)} seconds on this device.`,
      };
    }
    return {
      label: "nature",
      tokens: natureFrames[1]!,
      voice: defaultVoice,
      motion: { kind: "none" },
      reply: "Done — a calm nature look is on.",
    };
  }

  if (/\b(dark|night)\b.+\b(theme|mode|look)\b/i.test(text) || /\b(theme|mode).+\b(dark|night)\b/i.test(text)) {
    return {
      label: "dark",
      tokens: assertAppearanceTokens({
        colorMode: "dark",
        accent: "#4c5fd6",
        density: "comfortable",
        fontScale: 1,
        background: { kind: "gradient", id: "night" },
      }),
      voice: defaultVoice,
      motion: { kind: "none" },
      reply: "Done — dark theme is on.",
    };
  }

  if (/\b(light|day)\b.+\b(theme|mode|look)\b/i.test(text) || /\b(theme|mode).+\b(light|day)\b/i.test(text)) {
    return {
      label: "light",
      tokens: assertAppearanceTokens({
        colorMode: "light",
        accent: "#24348f",
        density: "comfortable",
        fontScale: 1,
        background: { kind: "none" },
      }),
      voice: defaultVoice,
      motion: { kind: "none" },
      reply: "Done — light theme is on.",
    };
  }

  if (/\breset\b.+\b(theme|appearance)\b/i.test(text) || /\bdefault theme\b/i.test(text)) {
    return {
      label: "reset",
      tokens: assertAppearanceTokens({
        colorMode: "system",
        accent: "#4c5fd6",
        density: "comfortable",
        fontScale: 1,
        background: { kind: "none" },
      }),
      voice: defaultVoice,
      motion: { kind: "none" },
      reply: "Done — appearance is back to the default.",
    };
  }

  return null;
}

export function isThemeCue(input: string): boolean {
  return parseThemeRequest(input) !== null;
}

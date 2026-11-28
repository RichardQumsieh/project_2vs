import type { ModelClientConfig } from "./model-provider.js";
import { chatCompletionsUrl, resolveModelMode } from "./model-provider.js";
import { relativeLuminance } from "./contrast.js";
import { consumeRateLimit, pruneRateLimits, type RateBucket } from "./rate-limit.js";
import { screenThemeText, themeJsonTooLarge } from "./theme-content.js";
import {
  THEME_RESPONSE_SCHEMA,
  acceptTheme,
  type ContrastAdjustment,
  type GeneratedTheme,
} from "./theme-tokens.js";

export const THEME_GENERATE_LIMIT = 8;
export const THEME_GENERATE_WINDOW_MS = 60 * 60 * 1000;

const SYSTEM_PROMPT = [
  "You design original app themes for a private messenger.",
  "Return one JSON object that matches the schema exactly.",
  "Express the request only as a name, one emoji, font weight, corner radius, and hex colors.",
  "Wallpaper is a geometric motif (gradient, dots, waves, grid, rings, rays, or diagonal) and 2 to 4 hex colors.",
  "Do not include logos, trademarked artwork, celebrity likenesses, photographs, SVG, URLs, or image data.",
  "A character or person named in the request is inspiration for color and motif only. Do not copy a logo or costume art.",
  "Light and dark palettes must both be readable: text on backgrounds and bubble fills at least WCAG AA (4.5:1), and accents at least 3:1.",
  "If a tweak is provided, change the previous theme in that direction instead of ignoring it.",
].join(" ");

export type GenerateThemeResult =
  | {
      ok: true;
      status: 200;
      theme: GeneratedTheme;
      adjustments: ContrastAdjustment[];
      source: "model" | "mock";
    }
  | { ok: false; status: number; error: string };

function hashString(input: string): number {
  let hash = 2166136261;
  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = light - c / 2;
  const channel = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${channel(r1)}${channel(g1)}${channel(b1)}`;
}

const EMOJI = ["✨", "🌊", "🌙", "🔥", "🌿", "🎨", "⚡", "🌸"];
const MOTIFS = ["gradient", "dots", "waves", "grid", "rings", "rays", "diagonal"] as const;
const WEIGHTS = ["regular", "medium", "semibold", "bold"] as const;

export function mockTheme(prompt: string, tweak?: string): GeneratedTheme {
  const seed = hashString(prompt);
  const lower = tweak?.toLowerCase() ?? "";
  const hueShift = lower.includes("darker") || lower.includes("lighter") ? 0 : (tweak ? hashString(tweak) % 36 : 0);
  const hue = (seed + hueShift) % 360;
  let lightL = 94;
  let darkL = 10;
  if (lower.includes("darker")) {
    lightL = 78;
    darkL = 5;
  } else if (lower.includes("lighter")) {
    lightL = 97;
    darkL = 18;
  }
  const accent = hslToHex(hue, 62, 42);
  const secondary = hslToHex((hue + 28) % 360, 48, 36);
  const light = {
    primary: accent,
    secondary,
    accent,
    background: hslToHex(hue, 28, lightL),
    surface: hslToHex(hue, 22, Math.min(99, lightL + 3)),
    bubbleMine: hslToHex(hue, 58, 32),
    bubbleTheirs: "#ffffff",
    text: "#1a1a1a",
    textMuted: "#3a3a3a",
    textOnMine: "#ffffff",
    textOnTheirs: "#1a1a1a",
  };
  const dark = {
    primary: hslToHex(hue, 70, 72),
    secondary: hslToHex((hue + 28) % 360, 55, 68),
    accent: hslToHex(hue, 70, 72),
    background: hslToHex(hue, 24, darkL),
    surface: hslToHex(hue, 18, Math.min(24, darkL + 6)),
    bubbleMine: hslToHex(hue, 55, 46),
    bubbleTheirs: hslToHex(hue, 16, 18),
    text: "#f7f7f5",
    textMuted: "#d5d5d2",
    textOnMine: "#111111",
    textOnTheirs: "#f7f7f5",
  };
  const words = prompt.split(/\s+/).slice(0, 3).join(" ").slice(0, 32);
  const accepted = acceptTheme({
    name: words || "Custom theme",
    emoji: EMOJI[seed % EMOJI.length],
    fontWeight: WEIGHTS[seed % WEIGHTS.length],
    cornerRadius: 12 + (seed % 4) * 4,
    iconAccent: accent,
    light,
    dark,
    wallpaper: {
      motif: MOTIFS[seed % MOTIFS.length],
      angle: (seed % 12) * 30,
      colors: [accent, secondary, light.background],
    },
  });
  if (!accepted.ok) {
    throw new Error(accepted.error);
  }
  return accepted.theme;
}

export function parseModelJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as unknown;
}

export function themeSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

async function requestThemeJson(input: {
  prompt: string;
  tweak?: string;
  previous?: GeneratedTheme;
  config: ModelClientConfig;
}): Promise<string> {
  const fetchImpl = input.config.fetchImpl ?? fetch;
  const url = chatCompletionsUrl(input.config.baseUrl!);
  const user = {
    prompt: input.prompt,
    tweak: input.tweak ?? null,
    previous: input.previous ?? null,
  };
  const body = {
    model: input.config.model || "grok-4",
    temperature: 0.4,
    max_tokens: input.config.maxOutputTokens ?? 1_200,
    stream: false,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(user) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "sophia_theme",
        strict: true,
        schema: THEME_RESPONSE_SCHEMA,
      },
    },
  };
  const response = await fetchImpl(url, {
    method: "POST",
    redirect: "error",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.config.timeoutMs ?? 20_000),
  });
  if (!response.ok) {
    throw new Error(`model status ${response.status}`);
  }
  const payload = await response.json() as { choices?: { message?: { content?: unknown } }[] };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("empty model theme");
  }
  return content;
}

export async function generateThemeForUser(input: {
  userId: string;
  prompt: string;
  tweak?: string;
  previous?: unknown;
  now: number;
  buckets: Map<string, RateBucket>;
  config?: ModelClientConfig;
}): Promise<GenerateThemeResult> {
  const prompt = screenThemeText(input.prompt, 180);
  if (!prompt.ok) return { ok: false, status: 400, error: prompt.error };
  let tweak: string | undefined;
  if (input.tweak && input.tweak.trim()) {
    const screened = screenThemeText(input.tweak, 120);
    if (!screened.ok) return { ok: false, status: 400, error: screened.error };
    tweak = screened.text;
  }
  let previous: GeneratedTheme | undefined;
  if (input.previous !== undefined) {
    const acceptedPrevious = acceptTheme(input.previous);
    if (!acceptedPrevious.ok) return { ok: false, status: 400, error: "The previous theme is not valid." };
    previous = acceptedPrevious.theme;
  }
  pruneRateLimits(input.buckets, THEME_GENERATE_WINDOW_MS, input.now);
  const rate = consumeRateLimit(
    input.buckets,
    `theme:${input.userId}`,
    THEME_GENERATE_LIMIT,
    THEME_GENERATE_WINDOW_MS,
    input.now,
  );
  if (!rate.ok) {
    return { ok: false, status: 429, error: "Theme generation is limited. Try again later." };
  }
  const config = input.config ?? {};
  if (resolveModelMode(config) === "mock") {
    const theme = mockTheme(prompt.text, tweak);
    return { ok: true, status: 200, theme, adjustments: [], source: "mock" };
  }
  try {
    const content = await requestThemeJson({ prompt: prompt.text, tweak, previous, config });
    if (themeJsonTooLarge(content)) return { ok: false, status: 502, error: "The theme response was too large." };
    const accepted = acceptTheme(parseModelJson(content));
    if (!accepted.ok) return { ok: false, status: 502, error: accepted.error };
    if (themeJsonTooLarge(accepted.theme)) return { ok: false, status: 502, error: "The theme response was too large." };
    return {
      ok: true,
      status: 200,
      theme: accepted.theme,
      adjustments: accepted.adjustments,
      source: "model",
    };
  } catch {
    return { ok: false, status: 502, error: "Sophia could not generate a theme. Try again." };
  }
}

export function backgroundLuminance(theme: GeneratedTheme, mode: "light" | "dark"): number {
  return relativeLuminance(theme[mode].background);
}

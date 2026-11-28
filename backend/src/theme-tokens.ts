import { z } from "zod";
import {
  TEXT_CONTRAST,
  UI_CONTRAST,
  contrastRatio,
  ensureTextContrast,
  ensureUiContrast,
} from "./contrast.js";

export const HEX = /^#[0-9a-fA-F]{6}$/;

const hex = z.string().regex(HEX);

export const FONT_WEIGHTS = ["regular", "medium", "semibold", "bold"] as const;
export const WALLPAPER_MOTIFS = ["gradient", "dots", "waves", "grid", "rings", "rays", "diagonal"] as const;

export const paletteSchema = z.object({
  primary: hex,
  secondary: hex,
  accent: hex,
  background: hex,
  surface: hex,
  bubbleMine: hex,
  bubbleTheirs: hex,
  text: hex,
  textMuted: hex,
  textOnMine: hex,
  textOnTheirs: hex,
}).strict();

export const wallpaperSchema = z.object({
  motif: z.enum(WALLPAPER_MOTIFS),
  angle: z.number().int().min(0).max(360),
  colors: z.array(hex).min(2).max(4),
}).strict();

export const generatedThemeSchema = z.object({
  name: z.string().trim().min(1).max(32),
  emoji: z.string().trim().min(1).max(16),
  fontWeight: z.enum(FONT_WEIGHTS),
  cornerRadius: z.number().int().min(8).max(28),
  iconAccent: hex,
  light: paletteSchema,
  dark: paletteSchema,
  wallpaper: wallpaperSchema,
}).strict();

export type ThemePalette = z.infer<typeof paletteSchema>;
export type GeneratedTheme = z.infer<typeof generatedThemeSchema>;

export type ContrastAdjustment = {
  path: string;
  from: string;
  to: string;
};

const NAME_PATTERN = /^[\p{L}\p{N}\p{Extended_Pictographic}\s'’.,!&+-]{1,32}$/u;

export function themeIssue(theme: GeneratedTheme): string | null {
  if (!NAME_PATTERN.test(theme.name)) return "Theme names use letters, numbers, and a short emoji.";
  if (/[<>]|https?:|data:/i.test(theme.emoji) || /[<>]|https?:|data:/i.test(theme.name)) {
    return "Theme names cannot include links or markup.";
  }
  return null;
}

function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function normalizePalette(palette: ThemePalette): ThemePalette {
  return {
    primary: normalizeHex(palette.primary),
    secondary: normalizeHex(palette.secondary),
    accent: normalizeHex(palette.accent),
    background: normalizeHex(palette.background),
    surface: normalizeHex(palette.surface),
    bubbleMine: normalizeHex(palette.bubbleMine),
    bubbleTheirs: normalizeHex(palette.bubbleTheirs),
    text: normalizeHex(palette.text),
    textMuted: normalizeHex(palette.textMuted),
    textOnMine: normalizeHex(palette.textOnMine),
    textOnTheirs: normalizeHex(palette.textOnTheirs),
  };
}

function assign(palette: ThemePalette, key: keyof ThemePalette, next: string, path: string, adjustments: ContrastAdjustment[]) {
  const from = palette[key];
  const to = next.toLowerCase();
  if (from.toLowerCase() !== to) {
    adjustments.push({ path, from: from.toLowerCase(), to });
    palette[key] = to;
  }
}

function enforcePalette(palette: ThemePalette, prefix: string, adjustments: ContrastAdjustment[]) {
  assign(palette, "text", ensureTextContrast(palette.text, palette.background, TEXT_CONTRAST), `${prefix}.text`, adjustments);
  assign(palette, "textMuted", ensureTextContrast(palette.textMuted, palette.background, TEXT_CONTRAST), `${prefix}.textMuted`, adjustments);
  assign(palette, "primary", ensureUiContrast(palette.primary, palette.background, UI_CONTRAST), `${prefix}.primary`, adjustments);
  assign(palette, "accent", ensureUiContrast(palette.accent, palette.background, UI_CONTRAST), `${prefix}.accent`, adjustments);
  assign(palette, "bubbleMine", ensureUiContrast(palette.bubbleMine, palette.background, UI_CONTRAST), `${prefix}.bubbleMine`, adjustments);
  assign(palette, "bubbleTheirs", ensureUiContrast(palette.bubbleTheirs, palette.background, UI_CONTRAST), `${prefix}.bubbleTheirs`, adjustments);
  assign(palette, "surface", ensureUiContrast(palette.surface, palette.background, UI_CONTRAST), `${prefix}.surface`, adjustments);
  assign(palette, "textOnMine", ensureTextContrast(palette.textOnMine, palette.bubbleMine, TEXT_CONTRAST), `${prefix}.textOnMine`, adjustments);
  assign(palette, "textOnTheirs", ensureTextContrast(palette.textOnTheirs, palette.bubbleTheirs, TEXT_CONTRAST), `${prefix}.textOnTheirs`, adjustments);
  assign(palette, "secondary", ensureUiContrast(palette.secondary, palette.background, UI_CONTRAST), `${prefix}.secondary`, adjustments);
}

function iconAgainstBoth(color: string, lightBackground: string, darkBackground: string): string {
  const score = (candidate: string) =>
    (contrastRatio(candidate, lightBackground) >= UI_CONTRAST ? 1 : 0) +
    (contrastRatio(candidate, darkBackground) >= UI_CONTRAST ? 1 : 0);
  const lightFixed = ensureUiContrast(color, lightBackground, UI_CONTRAST);
  const darkFixed = ensureUiContrast(color, darkBackground, UI_CONTRAST);
  return score(darkFixed) > score(lightFixed) ? darkFixed : lightFixed;
}

/** Validate a model object and rewrite any pair that misses WCAG AA. */
export function acceptTheme(value: unknown): { ok: true; theme: GeneratedTheme; adjustments: ContrastAdjustment[] } | { ok: false; error: string } {
  const parsed = generatedThemeSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: "The theme did not match the required color schema." };
  const issue = themeIssue(parsed.data);
  if (issue) return { ok: false, error: issue };
  const theme: GeneratedTheme = {
    ...parsed.data,
    name: parsed.data.name.trim(),
    emoji: parsed.data.emoji.trim(),
    iconAccent: normalizeHex(parsed.data.iconAccent),
    light: normalizePalette(parsed.data.light),
    dark: normalizePalette(parsed.data.dark),
    wallpaper: {
      ...parsed.data.wallpaper,
      colors: parsed.data.wallpaper.colors.map(normalizeHex),
    },
  };
  const adjustments: ContrastAdjustment[] = [];
  enforcePalette(theme.light, "light", adjustments);
  enforcePalette(theme.dark, "dark", adjustments);
  const icon = iconAgainstBoth(theme.iconAccent, theme.light.background, theme.dark.background);
  if (icon !== theme.iconAccent) {
    adjustments.push({ path: "iconAccent", from: theme.iconAccent, to: icon });
    theme.iconAccent = icon;
  }
  return { ok: true, theme, adjustments };
}

export function paletteMeetsContrast(palette: ThemePalette): boolean {
  return (
    contrastRatio(palette.text, palette.background) >= TEXT_CONTRAST &&
    contrastRatio(palette.textMuted, palette.background) >= TEXT_CONTRAST &&
    contrastRatio(palette.textOnMine, palette.bubbleMine) >= TEXT_CONTRAST &&
    contrastRatio(palette.textOnTheirs, palette.bubbleTheirs) >= TEXT_CONTRAST &&
    contrastRatio(palette.primary, palette.background) >= UI_CONTRAST &&
    contrastRatio(palette.accent, palette.background) >= UI_CONTRAST &&
    contrastRatio(palette.bubbleMine, palette.background) >= UI_CONTRAST &&
    contrastRatio(palette.bubbleTheirs, palette.background) >= UI_CONTRAST
  );
}

/** JSON schema sent to the model. No image, URL, or SVG fields exist. */
export const THEME_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "emoji", "fontWeight", "cornerRadius", "iconAccent", "light", "dark", "wallpaper"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 32 },
    emoji: { type: "string", minLength: 1, maxLength: 8 },
    fontWeight: { type: "string", enum: [...FONT_WEIGHTS] },
    cornerRadius: { type: "integer", minimum: 8, maximum: 28 },
    iconAccent: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    light: { $ref: "#/$defs/palette" },
    dark: { $ref: "#/$defs/palette" },
    wallpaper: {
      type: "object",
      additionalProperties: false,
      required: ["motif", "angle", "colors"],
      properties: {
        motif: { type: "string", enum: [...WALLPAPER_MOTIFS] },
        angle: { type: "integer", minimum: 0, maximum: 360 },
        colors: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        },
      },
    },
  },
  $defs: {
    palette: {
      type: "object",
      additionalProperties: false,
      required: [
        "primary", "secondary", "accent", "background", "surface",
        "bubbleMine", "bubbleTheirs", "text", "textMuted", "textOnMine", "textOnTheirs",
      ],
      properties: {
        primary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        secondary: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        accent: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        background: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        surface: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        bubbleMine: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        bubbleTheirs: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        text: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        textMuted: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        textOnMine: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        textOnTheirs: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
      },
    },
  },
} as const;

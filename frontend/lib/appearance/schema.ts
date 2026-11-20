import { z } from "zod";
import {
  accentInk,
  contrastRatio,
  TEXT_CONTRAST,
  UI_CONTRAST,
  worstScrimBackgrounds,
} from "./contrast";

export const FONT_SCALE_MIN = 0.875;
export const FONT_SCALE_MAX = 1.25;
export const FONT_SCALE_STEP = 0.0625;

export const COLOR_MODES = ["system", "light", "dark"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const GRADIENT_IDS = ["dusk", "harbor", "paper", "night"] as const;
export const CURATED_IDS = ["linen", "cedar", "tide", "ink"] as const;

export type ColorMode = (typeof COLOR_MODES)[number];
export type Density = (typeof DENSITIES)[number];
export type GradientId = (typeof GRADIENT_IDS)[number];
export type CuratedId = (typeof CURATED_IDS)[number];

/** Page colors already shipped in globals.css. Tokens are checked against these. */
export const MODE_PALETTE = {
  light: { background: "#f3f6fb", foreground: "#1d293b" },
  dark: { background: "#080d16", foreground: "#f5f7fb" },
} as const;

const uploadId = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

export const backgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("gradient"), id: z.enum(GRADIENT_IDS) }).strict(),
  z.object({ kind: z.literal("curated"), id: z.enum(CURATED_IDS) }).strict(),
  z.object({ kind: z.literal("upload"), id: uploadId }).strict(),
]);

export const appearanceTokensSchema = z
  .object({
    colorMode: z.enum(COLOR_MODES),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    density: z.enum(DENSITIES),
    fontScale: z.number().finite(),
    background: backgroundSchema,
  })
  .strict();

export type AppearanceTokens = {
  colorMode: ColorMode;
  accent: string;
  density: Density;
  fontScale: number;
  background:
    | { kind: "none" }
    | { kind: "gradient"; id: GradientId }
    | { kind: "curated"; id: CuratedId }
    | { kind: "upload"; id: string };
};

export type ThemeIssue = {
  code: "schema" | "range" | "contrast";
  path: string;
  message: string;
  ratio?: number;
  required?: number;
};

export type TokenParseResult =
  | { ok: true; tokens: AppearanceTokens }
  | { ok: false; issues: ThemeIssue[] };

export function isFontScale(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const steps = Math.round((value - FONT_SCALE_MIN) / FONT_SCALE_STEP);
  if (steps < 0 || steps > Math.round((FONT_SCALE_MAX - FONT_SCALE_MIN) / FONT_SCALE_STEP)) {
    return false;
  }
  const snapped = Number((FONT_SCALE_MIN + steps * FONT_SCALE_STEP).toFixed(4));
  return Math.abs(snapped - value) < 1e-6;
}

export function surfacesFor(colorMode: ColorMode) {
  if (colorMode === "system") return [MODE_PALETTE.light, MODE_PALETTE.dark];
  return [MODE_PALETTE[colorMode]];
}

export function contrastIssuesFor(tokens: Pick<AppearanceTokens, "colorMode" | "accent">): ThemeIssue[] {
  const issues: ThemeIssue[] = [];
  for (const surface of surfacesFor(tokens.colorMode)) {
    const textRatio = contrastRatio(surface.foreground, surface.background);
    if (textRatio < TEXT_CONTRAST) {
      issues.push({
        code: "contrast",
        path: "foreground",
        message: "Text on the page background is below WCAG AA.",
        ratio: roundRatio(textRatio),
        required: TEXT_CONTRAST,
      });
    }
    for (const scrim of worstScrimBackgrounds(surface.background)) {
      const scrimRatio = contrastRatio(surface.foreground, scrim);
      if (scrimRatio < TEXT_CONTRAST) {
        issues.push({
          code: "contrast",
          path: "background",
          message: "Text over the background scrim is below WCAG AA.",
          ratio: roundRatio(scrimRatio),
          required: TEXT_CONTRAST,
        });
      }
    }
    const uiRatio = contrastRatio(tokens.accent, surface.background);
    if (uiRatio < UI_CONTRAST) {
      issues.push({
        code: "contrast",
        path: "accent",
        message: "Accent against the page background is below WCAG AA for interface graphics.",
        ratio: roundRatio(uiRatio),
        required: UI_CONTRAST,
      });
    }
  }
  const ink = accentInk(tokens.accent);
  const inkRatio = contrastRatio(ink, tokens.accent);
  if (inkRatio < TEXT_CONTRAST) {
    issues.push({
      code: "contrast",
      path: "accent",
      message: "Accent button text is below WCAG AA.",
      ratio: roundRatio(inkRatio),
      required: TEXT_CONTRAST,
    });
  }
  return issues;
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100;
}

function schemaIssues(error: z.ZodError): ThemeIssue[] {
  return error.issues.map((issue) => ({
    code: "schema" as const,
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

export function parseAppearanceTokens(input: unknown): TokenParseResult {
  const parsed = appearanceTokensSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: schemaIssues(parsed.error) };
  if (!isFontScale(parsed.data.fontScale)) {
    return {
      ok: false,
      issues: [
        {
          code: "range",
          path: "fontScale",
          message: "Font scale must be from 0.875 to 1.25 in steps of 0.0625.",
        },
      ],
    };
  }
  const tokens: AppearanceTokens = {
    ...parsed.data,
    accent: parsed.data.accent.toLowerCase(),
    background:
      parsed.data.background.kind === "upload"
        ? { kind: "upload", id: parsed.data.background.id.toLowerCase() }
        : parsed.data.background,
  };
  const contrast = contrastIssuesFor(tokens);
  if (contrast.length > 0) return { ok: false, issues: contrast };
  return { ok: true, tokens };
}

export function assertAppearanceTokens(input: unknown): AppearanceTokens {
  const parsed = parseAppearanceTokens(input);
  if (!parsed.ok) {
    throw new Error(parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return parsed.tokens;
}

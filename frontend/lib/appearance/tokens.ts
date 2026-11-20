import { CURATED_DATA_URI, GRADIENT_CSS } from "./backgrounds";
import {
  MODE_PALETTE,
  assertAppearanceTokens,
  type AppearanceTokens,
  type ColorMode,
} from "./schema";

export const ACCENT_SWATCHES = [
  "#4c5fd6",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#2e7d32",
  "#0369a1",
] as const;

export const defaultTokens: AppearanceTokens = assertAppearanceTokens({
  colorMode: "system",
  accent: "#4c5fd6",
  density: "comfortable",
  fontScale: 1,
  background: { kind: "none" },
});

export const eveningTokens: AppearanceTokens = assertAppearanceTokens({
  colorMode: "dark",
  accent: "#c9cff8",
  density: "comfortable",
  fontScale: 1,
  background: { kind: "gradient", id: "dusk" },
});

export const morningTokens: AppearanceTokens = assertAppearanceTokens({
  colorMode: "light",
  accent: "#24348f",
  density: "compact",
  fontScale: 1,
  background: { kind: "none" },
});

export const familyTokens: AppearanceTokens = assertAppearanceTokens({
  colorMode: "light",
  accent: "#8a4b16",
  density: "spacious",
  fontScale: 1.0625,
  background: { kind: "curated", id: "cedar" },
});

export function readingTokens(current: AppearanceTokens): AppearanceTokens {
  return assertAppearanceTokens({
    ...current,
    density: "comfortable",
    fontScale: current.fontScale < 1.0625 ? 1.0625 : current.fontScale,
  });
}

export function sameTokens(left: AppearanceTokens, right: AppearanceTokens): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function backgroundCss(tokens: AppearanceTokens, uploadUrl: string | null): string | null {
  if (tokens.background.kind === "none") return null;
  if (tokens.background.kind === "gradient") return GRADIENT_CSS[tokens.background.id];
  if (tokens.background.kind === "curated") {
    return `url("${CURATED_DATA_URI[tokens.background.id]}")`;
  }
  if (!uploadUrl || !uploadUrl.startsWith("blob:")) return null;
  return `url("${uploadUrl}")`;
}

export function paletteFor(colorMode: ColorMode, prefersDark: boolean) {
  if (colorMode === "dark" || (colorMode === "system" && prefersDark)) return MODE_PALETTE.dark;
  return MODE_PALETTE.light;
}

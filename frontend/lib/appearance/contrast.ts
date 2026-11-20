/** WCAG 2.x relative luminance and contrast. Ratios use the standard 0.05 offset. */

export const TEXT_CONTRAST = 4.5;
export const UI_CONTRAST = 3;

/**
 * How much of a background image is allowed to show through the scrim.
 * Text contrast is checked against this worst-case mix, not against image pixels.
 */
export const SCRIM_BLEED = 0.12;

export type Rgb = { r: number; g: number; b: number };

export function parseHex(input: string): Rgb | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(input);
  if (!match) return null;
  const hex = match[1] ?? "";
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

export function formatHex(rgb: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

function linearize(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) {
    throw new Error("Expected a #RRGGBB color.");
  }
  return (
    0.2126 * linearize(rgb.r) +
    0.7152 * linearize(rgb.g) +
    0.0722 * linearize(rgb.b)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const left = relativeLuminance(foreground);
  const right = relativeLuminance(background);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export function mixHex(base: string, overlay: string, overlayAmount: number): string {
  const from = parseHex(base);
  const to = parseHex(overlay);
  if (!from || !to) {
    throw new Error("Expected a #RRGGBB color.");
  }
  const amount = Math.max(0, Math.min(1, overlayAmount));
  const channel = (start: number, end: number) => start * (1 - amount) + end * amount;
  return formatHex({
    r: channel(from.r, to.r),
    g: channel(from.g, to.g),
    b: channel(from.b, to.b),
  });
}

/** Black or white text, whichever contrasts more with the accent fill. */
export function accentInk(accent: string): "#000000" | "#ffffff" {
  const black = contrastRatio(accent, "#000000");
  const white = contrastRatio(accent, "#ffffff");
  return black >= white ? "#000000" : "#ffffff";
}

export function worstScrimBackgrounds(background: string): string[] {
  return [
    mixHex(background, "#ffffff", SCRIM_BLEED),
    mixHex(background, "#000000", SCRIM_BLEED),
  ];
}

/** Foreground mixed toward the background, still at least AA for normal text. */
export function mutedColor(foreground: string, background: string): string {
  let best = foreground;
  for (let step = 1; step <= 16; step += 1) {
    const mixed = mixHex(foreground, background, step / 16);
    if (contrastRatio(mixed, background) < TEXT_CONTRAST) break;
    best = mixed;
  }
  return best;
}

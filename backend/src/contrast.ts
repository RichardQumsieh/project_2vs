/** WCAG 2.x relative luminance and contrast. Ratios use the standard 0.05 offset. */

export const TEXT_CONTRAST = 4.5;
export const UI_CONTRAST = 3;

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
  if (!rgb) throw new Error("Expected a #RRGGBB color.");
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b);
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
  if (!from || !to) throw new Error("Expected a #RRGGBB color.");
  const amount = Math.max(0, Math.min(1, overlayAmount));
  const channel = (start: number, end: number) => start * (1 - amount) + end * amount;
  return formatHex({
    r: channel(from.r, to.r),
    g: channel(from.g, to.g),
    b: channel(from.b, to.b),
  });
}

/** Black or white, whichever contrasts more with the fill. */
export function inkFor(fill: string): "#000000" | "#ffffff" {
  return contrastRatio("#000000", fill) >= contrastRatio("#ffffff", fill) ? "#000000" : "#ffffff";
}

/** Push a text color to black or white until it meets `minimum` against `background`. */
export function ensureTextContrast(foreground: string, background: string, minimum = TEXT_CONTRAST): string {
  if (contrastRatio(foreground, background) >= minimum) return foreground.toLowerCase();
  return inkFor(background);
}

/**
 * Move a UI color toward black or white until it meets `minimum` against `background`.
 * The hue is preserved as long as possible.
 */
export function ensureUiContrast(color: string, background: string, minimum = UI_CONTRAST): string {
  if (contrastRatio(color, background) >= minimum) return color.toLowerCase();
  const toward = relativeLuminance(background) > 0.4 ? "#000000" : "#ffffff";
  let current = color;
  for (let step = 1; step <= 24; step += 1) {
    current = mixHex(color, toward, step / 24);
    if (contrastRatio(current, background) >= minimum) return current;
  }
  return toward;
}

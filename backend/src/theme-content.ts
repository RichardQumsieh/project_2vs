/**
 * Blocks theme prompts and names that ask for sexual content involving minors,
 * slurs, or instructions to embed a remote image or logo file.
 * A prompt may name a character or person as color and motif inspiration.
 * The generator never accepts image URLs, SVG markup, or logo files.
 */

const BLOCKED: RegExp[] = [
  /\b(?:csam|child[\s-]*porn|child[\s-]*sexual|underage[\s-]*sex|preteen[\s-]*sex)\b/i,
  /\b(?:loli|lolita|shota)\b/i,
  /\b(?:nigger|faggot|kike|spic|retard)\b/i,
  /\b(?:kill\s+yourself|kys)\b/i,
];

const REMOTE_IMAGE = /\b(?:https?:\/\/|data:image\/|<\s*(?:img|svg|image)\b)/i;

export const PROMPT_MAX = 180;
export const TWEAK_MAX = 120;
export const THEME_JSON_MAX = 8_000;
export const THEMES_PER_USER_MAX = 40;
export const GALLERY_PAGE_MAX = 24;

export type ContentDecision =
  | { ok: true; text: string }
  | { ok: false; error: string };

export function screenThemeText(value: string, max: number): ContentDecision {
  const text = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, error: "Describe the theme in a few words." };
  if (text.length > max) return { ok: false, error: `Keep that description under ${max} characters.` };
  if (REMOTE_IMAGE.test(text)) {
    return { ok: false, error: "Themes are colors and patterns only. Links and images are not accepted." };
  }
  if (BLOCKED.some((pattern) => pattern.test(text))) {
    return { ok: false, error: "That description can't be used for a theme." };
  }
  return { ok: true, text };
}

export function themeJsonTooLarge(value: unknown): boolean {
  try {
    return JSON.stringify(value).length > THEME_JSON_MAX;
  } catch {
    return true;
  }
}

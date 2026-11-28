/**
 * Procedural avatar parameters. Geometry is generated on the device from this
 * JSON; no third-party meshes or textures are shipped. The generator output is
 * dedicated to the public domain (CC0) by this project.
 *
 * Profile fields (display name, photo URL, interests) are stored on the account
 * and shown to signed-in people. Avatar config and the greeting follow that
 * same path. They are not part of message ciphertext.
 */

export const AVATAR_ASSET_LICENSE =
  "Procedural low-poly geometry generated in Sophia. No third-party meshes or textures. Dedicated to the public domain (CC0).";

export const AVATAR_JSON_MAX = 2048;
export const GREETING_TEXT_MAX = 80;

export const BODY_SHAPES = ["slim", "average", "broad"] as const;
export const HEAD_SHAPES = ["round", "oval", "square"] as const;
export const HAIR_STYLES = ["bald", "short", "bob", "long", "bun", "curly", "mohawk"] as const;
export const EYE_SHAPES = ["round", "almond", "wide"] as const;
export const BROW_STYLES = ["soft", "straight", "arched", "thick"] as const;
export const MOUTH_STYLES = ["smile", "neutral", "grin", "open"] as const;
export const FACIAL_HAIR = ["none", "stubble", "beard", "mustache"] as const;
export const GLASSES = ["none", "round", "rect", "sun"] as const;
export const ACCESSORIES = ["none", "earrings", "cap", "headphones"] as const;
export const OUTFITS = ["tee", "hoodie", "collar", "dress"] as const;
export const GREETING_ANIMATIONS = ["wave", "nod", "thumbs-up", "dance"] as const;

export type BodyShape = (typeof BODY_SHAPES)[number];
export type HeadShape = (typeof HEAD_SHAPES)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type EyeShape = (typeof EYE_SHAPES)[number];
export type BrowStyle = (typeof BROW_STYLES)[number];
export type MouthStyle = (typeof MOUTH_STYLES)[number];
export type FacialHair = (typeof FACIAL_HAIR)[number];
export type GlassesStyle = (typeof GLASSES)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type Outfit = (typeof OUTFITS)[number];
export type GreetingAnimation = (typeof GREETING_ANIMATIONS)[number];

export type AvatarConfig = {
  v: 1;
  body: BodyShape;
  head: HeadShape;
  skin: string;
  hair: HairStyle;
  hairColor: string;
  eyes: EyeShape;
  eyeColor: string;
  brows: BrowStyle;
  mouth: MouthStyle;
  facialHair: FacialHair;
  glasses: GlassesStyle;
  accessory: Accessory;
  outfit: Outfit;
  top: string;
  accent: string;
};

export const SKIN_SWATCHES = ["#f6d7c3", "#e0b08a", "#c68642", "#8d5524", "#5c3317", "#f1c7a1", "#a56b45", "#3b2416"];
export const HAIR_SWATCHES = ["#1b1b1f", "#4a3428", "#8a5a2b", "#d4a017", "#b55239", "#c7c7cf", "#2f5d50", "#d36b9a"];
export const EYE_SWATCHES = ["#3b2a1a", "#6b8caf", "#3f6b4e", "#8a8f98", "#c4a15a"];
export const CLOTH_SWATCHES = ["#6d55a5", "#243044", "#f4f1ea", "#c45c4a", "#2f6f62", "#d7b15e", "#1f1f24", "#d86b8a"];

const HEX = /^#[0-9a-fA-F]{6}$/;
const CONFIG_KEYS = [
  "v", "body", "head", "skin", "hair", "hairColor", "eyes", "eyeColor", "brows",
  "mouth", "facialHair", "glasses", "accessory", "outfit", "top", "accent",
] as const;

export function defaultAvatar(): AvatarConfig {
  return {
    v: 1,
    body: "average",
    head: "round",
    skin: "#e0b08a",
    hair: "short",
    hairColor: "#4a3428",
    eyes: "round",
    eyeColor: "#3b2a1a",
    brows: "soft",
    mouth: "smile",
    facialHair: "none",
    glasses: "none",
    accessory: "none",
    outfit: "tee",
    top: "#6d55a5",
    accent: "#f4f1ea",
  };
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function color(value: unknown): string | null {
  if (typeof value !== "string" || !HEX.test(value)) return null;
  return value.toLowerCase();
}

export function parseAvatarConfig(value: unknown): AvatarConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) return null;
  }
  if (record.v !== 1) return null;
  if (!oneOf(record.body, BODY_SHAPES)) return null;
  if (!oneOf(record.head, HEAD_SHAPES)) return null;
  if (!oneOf(record.hair, HAIR_STYLES)) return null;
  if (!oneOf(record.eyes, EYE_SHAPES)) return null;
  if (!oneOf(record.brows, BROW_STYLES)) return null;
  if (!oneOf(record.mouth, MOUTH_STYLES)) return null;
  if (!oneOf(record.facialHair, FACIAL_HAIR)) return null;
  if (!oneOf(record.glasses, GLASSES)) return null;
  if (!oneOf(record.accessory, ACCESSORIES)) return null;
  if (!oneOf(record.outfit, OUTFITS)) return null;
  const skin = color(record.skin);
  const hairColor = color(record.hairColor);
  const eyeColor = color(record.eyeColor);
  const top = color(record.top);
  const accent = color(record.accent);
  if (!skin || !hairColor || !eyeColor || !top || !accent) return null;
  return {
    v: 1,
    body: record.body,
    head: record.head,
    skin,
    hair: record.hair,
    hairColor,
    eyes: record.eyes,
    eyeColor,
    brows: record.brows,
    mouth: record.mouth,
    facialHair: record.facialHair,
    glasses: record.glasses,
    accessory: record.accessory,
    outfit: record.outfit,
    top,
    accent,
  };
}

export function canonicalAvatar(config: AvatarConfig): AvatarConfig {
  return parseAvatarConfig(config) ?? defaultAvatar();
}

export function avatarCacheKey(config: AvatarConfig): string {
  return JSON.stringify(canonicalAvatar(config));
}

export function avatarJsonTooLarge(value: unknown): boolean {
  try {
    return JSON.stringify(value).length > AVATAR_JSON_MAX;
  } catch {
    return true;
  }
}

export function parseGreetingText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > GREETING_TEXT_MAX || /[\u0000-\u001F]/.test(text)) return null;
  return text;
}

export function parseGreetingAnimation(value: unknown): GreetingAnimation | null {
  return oneOf(value, GREETING_ANIMATIONS) ? value : null;
}

export type AvatarDraft = { current: AvatarConfig; past: AvatarConfig[] };

export function createDraft(current: AvatarConfig): AvatarDraft {
  return { current: canonicalAvatar(current), past: [] };
}

export function replaceDraft(draft: AvatarDraft, next: AvatarConfig, limit = 30): AvatarDraft {
  const current = canonicalAvatar(next);
  if (avatarCacheKey(draft.current) === avatarCacheKey(current)) return draft;
  return { current, past: [...draft.past, draft.current].slice(-limit) };
}

export function undoDraft(draft: AvatarDraft): AvatarDraft {
  const previous = draft.past[draft.past.length - 1];
  if (!previous) return draft;
  return { current: previous, past: draft.past.slice(0, -1) };
}

function pick<T>(options: readonly T[], rng: () => number): T {
  const index = Math.min(options.length - 1, Math.floor(rng() * options.length));
  return options[index]!;
}

export function randomAvatar(rng: () => number = Math.random): AvatarConfig {
  return {
    v: 1,
    body: pick(BODY_SHAPES, rng),
    head: pick(HEAD_SHAPES, rng),
    skin: pick(SKIN_SWATCHES, rng),
    hair: pick(HAIR_STYLES, rng),
    hairColor: pick(HAIR_SWATCHES, rng),
    eyes: pick(EYE_SHAPES, rng),
    eyeColor: pick(EYE_SWATCHES, rng),
    brows: pick(BROW_STYLES, rng),
    mouth: pick(MOUTH_STYLES, rng),
    facialHair: pick(FACIAL_HAIR, rng),
    glasses: pick(GLASSES, rng),
    accessory: pick(ACCESSORIES, rng),
    outfit: pick(OUTFITS, rng),
    top: pick(CLOTH_SWATCHES, rng),
    accent: pick(CLOTH_SWATCHES, rng),
  };
}

export type AvatarPerson = {
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  avatarConfig?: unknown;
  greetingText?: string | null;
  greetingAnimation?: string | null;
};

export function personInitials(person: AvatarPerson | null | undefined, fallback = "?"): string {
  const name = person?.displayName?.trim() || person?.username?.trim() || fallback;
  const parts = name.split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part.charAt(0).toLocaleUpperCase()).join("");
  return letters || fallback;
}

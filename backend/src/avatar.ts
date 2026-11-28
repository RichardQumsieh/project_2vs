import { z } from "zod";

export const AVATAR_JSON_MAX = 2048;
export const GREETING_TEXT_MAX = 80;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase());

export const avatarConfigSchema = z.object({
  v: z.literal(1),
  body: z.enum(["slim", "average", "broad"]),
  head: z.enum(["round", "oval", "square"]),
  skin: hex,
  hair: z.enum(["bald", "short", "bob", "long", "bun", "curly", "mohawk"]),
  hairColor: hex,
  eyes: z.enum(["round", "almond", "wide"]),
  eyeColor: hex,
  brows: z.enum(["soft", "straight", "arched", "thick"]),
  mouth: z.enum(["smile", "neutral", "grin", "open"]),
  facialHair: z.enum(["none", "stubble", "beard", "mustache"]),
  glasses: z.enum(["none", "round", "rect", "sun"]),
  accessory: z.enum(["none", "earrings", "cap", "headphones"]),
  outfit: z.enum(["tee", "hoodie", "collar", "dress"]),
  top: hex,
  accent: hex,
}).strict();

export const greetingAnimationSchema = z.enum(["wave", "nod", "thumbs-up", "dance"]);

export const updateAvatarSchema = z.object({
  avatarConfig: avatarConfigSchema.nullable(),
  greetingText: z.string().trim().max(GREETING_TEXT_MAX).refine(
    (value) => !/[\u0000-\u001F]/.test(value),
    "Greeting text cannot contain control characters",
  ).nullable(),
  greetingAnimation: greetingAnimationSchema.nullable(),
}).strict().refine(
  (value) => value.avatarConfig === null || JSON.stringify(value.avatarConfig).length <= AVATAR_JSON_MAX,
  "Avatar is too large",
);

export type PublicAvatar = {
  avatarConfig: z.infer<typeof avatarConfigSchema> | null;
  greetingText: string | null;
  greetingAnimation: z.infer<typeof greetingAnimationSchema> | null;
};

export function publicAvatar(user: {
  avatarConfig?: unknown;
  greetingText?: string | null;
  greetingAnimation?: string | null;
}): PublicAvatar {
  const config = avatarConfigSchema.safeParse(user.avatarConfig);
  const text = typeof user.greetingText === "string" ? user.greetingText.trim() : "";
  const animation = greetingAnimationSchema.safeParse(user.greetingAnimation);
  return {
    avatarConfig: config.success ? config.data : null,
    greetingText: text && text.length <= GREETING_TEXT_MAX && !/[\u0000-\u001F]/.test(text) ? text : null,
    greetingAnimation: animation.success ? animation.data : null,
  };
}

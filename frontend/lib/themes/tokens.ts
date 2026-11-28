export const THEME_FONT_WEIGHTS = ["regular", "medium", "semibold", "bold"] as const;
export const THEME_MOTIFS = ["gradient", "dots", "waves", "grid", "rings", "rays", "diagonal"] as const;

export type ThemeFontWeight = (typeof THEME_FONT_WEIGHTS)[number];
export type ThemeMotif = (typeof THEME_MOTIFS)[number];

export type ThemePalette = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  bubbleMine: string;
  bubbleTheirs: string;
  text: string;
  textMuted: string;
  textOnMine: string;
  textOnTheirs: string;
};

export type ThemeWallpaper = {
  motif: ThemeMotif;
  angle: number;
  colors: string[];
};

export type GeneratedTheme = {
  name: string;
  emoji: string;
  fontWeight: ThemeFontWeight;
  cornerRadius: number;
  iconAccent: string;
  light: ThemePalette;
  dark: ThemePalette;
  wallpaper: ThemeWallpaper;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHex(value: string): boolean {
  return HEX.test(value);
}

export function parseGeneratedTheme(value: unknown): GeneratedTheme | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const palette = (input: unknown): ThemePalette | null => {
    if (!input || typeof input !== "object") return null;
    const colors = input as Record<string, unknown>;
    const keys = ["primary", "secondary", "accent", "background", "surface", "bubbleMine", "bubbleTheirs", "text", "textMuted", "textOnMine", "textOnTheirs"] as const;
    const next = {} as ThemePalette;
    for (const key of keys) {
      if (typeof colors[key] !== "string" || !isHex(colors[key])) return null;
      next[key] = colors[key].toLowerCase();
    }
    return next;
  };
  const light = palette(record.light);
  const dark = palette(record.dark);
  const wallpaper = record.wallpaper;
  if (!light || !dark || !wallpaper || typeof wallpaper !== "object") return null;
  const paper = wallpaper as Record<string, unknown>;
  if (
    typeof record.name !== "string" ||
    record.name.trim().length < 1 ||
    record.name.trim().length > 32 ||
    /[<>]|https?:|data:/i.test(record.name) ||
    typeof record.emoji !== "string" ||
    /[<>]|https?:|data:/i.test(record.emoji) ||
    record.emoji.trim().length < 1 ||
    record.emoji.trim().length > 16 ||
    !THEME_FONT_WEIGHTS.includes(record.fontWeight as ThemeFontWeight) ||
    typeof record.cornerRadius !== "number" ||
    record.cornerRadius < 8 ||
    record.cornerRadius > 28 ||
    typeof record.iconAccent !== "string" ||
    !isHex(record.iconAccent) ||
    !THEME_MOTIFS.includes(paper.motif as ThemeMotif) ||
    typeof paper.angle !== "number" ||
    !Array.isArray(paper.colors) ||
    paper.colors.length < 2 ||
    paper.colors.length > 4 ||
    paper.colors.some((color) => typeof color !== "string" || !isHex(color))
  ) {
    return null;
  }
  return {
    name: record.name.trim(),
    emoji: record.emoji.trim(),
    fontWeight: record.fontWeight as ThemeFontWeight,
    cornerRadius: Math.round(record.cornerRadius),
    iconAccent: record.iconAccent.toLowerCase(),
    light,
    dark,
    wallpaper: {
      motif: paper.motif as ThemeMotif,
      angle: Math.round(paper.angle) % 361,
      colors: (paper.colors as string[]).map((color) => color.toLowerCase()),
    },
  };
}

const FONT_WEIGHT: Record<ThemeFontWeight, string> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

export function themeCssVariables(theme: GeneratedTheme, mode: "light" | "dark"): Record<string, string> {
  const palette = theme[mode];
  const channels = (hex: string) => {
    const value = hex.slice(1);
    return `${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}`;
  };
  return {
    "--background": palette.background,
    "--foreground": palette.text,
    "--muted": palette.textMuted,
    "--accent": palette.accent,
    "--accent-rgb": channels(palette.accent),
    "--accent-ink": palette.textOnMine,
    "--surface": palette.surface,
    "--primary": palette.primary,
    "--secondary": palette.secondary,
    "--bubble-mine": palette.bubbleMine,
    "--bubble-mine-text": palette.textOnMine,
    "--bubble-theirs": palette.bubbleTheirs,
    "--bubble-theirs-text": palette.textOnTheirs,
    "--theme-radius": `${theme.cornerRadius}px`,
    "--theme-font-weight": FONT_WEIGHT[theme.fontWeight],
    "--icon-accent": theme.iconAccent,
  };
}

export type SavedTheme = {
  id: string;
  name: string;
  emoji: string;
  tokens: GeneratedTheme;
  published: boolean;
  flagged: boolean;
  likeCount: number;
  liked: boolean;
  mine: boolean;
  createdAt: string;
  prompt?: string;
};

export function readSavedTheme(value: unknown): SavedTheme | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const tokens = parseGeneratedTheme(record.tokens);
  if (!tokens || typeof record.id !== "string" || typeof record.name !== "string") return null;
  return {
    id: record.id,
    name: record.name,
    emoji: typeof record.emoji === "string" ? record.emoji : tokens.emoji,
    tokens,
    published: record.published === true,
    flagged: record.flagged === true,
    likeCount: typeof record.likeCount === "number" ? record.likeCount : 0,
    liked: record.liked === true,
    mine: record.mine === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    prompt: typeof record.prompt === "string" ? record.prompt : undefined,
  };
}

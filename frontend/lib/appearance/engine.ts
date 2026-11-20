import { z } from "zod";
import { parseAppearanceTokens, type AppearanceTokens } from "./schema";
import {
  eveningTokens,
  familyTokens,
  morningTokens,
  readingTokens,
  sameTokens,
} from "./tokens";
import {
  parseVoice,
  sameVoice,
  type VoicePreferences,
} from "./voice";

export const PANEL_IDS = ["inbox", "sophia", "settings", "integrations"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const ADAPTATION_RULES = [
  "evening-calm",
  "morning-crisp",
  "family-warm",
  "arabic-drafts",
  "reading-room",
] as const;
export type AdaptationRuleId = (typeof ADAPTATION_RULES)[number];

export type LocalSignals = {
  locale: "en" | "ar";
  hour: number;
  role: "manager" | "family";
  panelUses: Record<PanelId, number>;
};

export type AppearanceProposal = {
  id: string;
  ruleId: AdaptationRuleId;
  createdAt: string;
  tokens: AppearanceTokens;
  voice: VoicePreferences;
};

const panelCount = z.number().int().min(0).max(10_000);

export const signalsSchema = z
  .object({
    locale: z.enum(["en", "ar"]),
    hour: z.number().int().min(0).max(23),
    role: z.enum(["manager", "family"]),
    panelUses: z
      .object({
        inbox: panelCount,
        sophia: panelCount,
        settings: panelCount,
        integrations: panelCount,
      })
      .strict(),
  })
  .strict();

export function emptyPanelUses(): Record<PanelId, number> {
  return { inbox: 0, sophia: 0, settings: 0, integrations: 0 };
}

export function parseSignals(input: unknown): LocalSignals | null {
  const parsed = signalsSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function panelForPath(pathname: string): PanelId | null {
  if (pathname.startsWith("/inbox")) return "inbox";
  if (pathname.startsWith("/sophia")) return "sophia";
  if (pathname.startsWith("/settings/integrations")) return "integrations";
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}

export function topPanel(uses: Record<PanelId, number>): PanelId | null {
  let best: PanelId | null = null;
  let bestCount = 0;
  for (const id of PANEL_IDS) {
    const count = uses[id];
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type AdaptationDecision = {
  ruleId: AdaptationRuleId;
  at: string;
  decision: "approved" | "dismissed";
};

function cooledDown(decisions: AdaptationDecision[], ruleId: AdaptationRuleId, now: Date): boolean {
  const last = [...decisions].reverse().find((decision) => decision.ruleId === ruleId);
  if (!last) return false;
  const at = Date.parse(last.at);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at < COOLDOWN_MS;
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function proposal(
  ruleId: AdaptationRuleId,
  now: Date,
  tokens: AppearanceTokens,
  voice: VoicePreferences,
): AppearanceProposal | null {
  const parsedTokens = parseAppearanceTokens(tokens);
  const parsedVoice = parseVoice(voice);
  if (!parsedTokens.ok || !parsedVoice.ok) return null;
  return {
    id: `${ruleId}:${dayKey(now)}`,
    ruleId,
    createdAt: now.toISOString(),
    tokens: parsedTokens.tokens,
    voice: parsedVoice.voice,
  };
}

function unchanged(
  currentTokens: AppearanceTokens,
  currentVoice: VoicePreferences,
  tokens: AppearanceTokens,
  voice: VoicePreferences,
): boolean {
  return sameTokens(currentTokens, tokens) && sameVoice(currentVoice, voice);
}

/**
 * One suggestion from local signals. Signals are locale, clock hour, a chosen
 * role, and panel-open counts. Chat plaintext is not an input.
 */
export function proposeAdaptation(
  currentTokens: AppearanceTokens,
  currentVoice: VoicePreferences,
  signals: LocalSignals,
  decisions: AdaptationDecision[],
  now: Date,
): AppearanceProposal | null {
  const parsed = parseSignals(signals);
  if (!parsed) return null;
  const evening = parsed.hour >= 18 || parsed.hour < 5;
  const morning = parsed.hour >= 5 && parsed.hour < 12;
  const candidates: Array<{ ruleId: AdaptationRuleId; tokens: AppearanceTokens; voice: VoicePreferences }> = [];

  if (evening) {
    candidates.push({
      ruleId: "evening-calm",
      tokens: eveningTokens,
      voice: {
        ...currentVoice,
        manner: parsed.role === "family" ? "friendly" : "formal",
        verbosity: "short",
      },
    });
  }
  if (morning && parsed.role === "manager" && topPanel(parsed.panelUses) === "inbox") {
    candidates.push({
      ruleId: "morning-crisp",
      tokens: morningTokens,
      voice: { ...currentVoice, manner: "formal", verbosity: "short" },
    });
  }
  if (parsed.role === "family" && !evening) {
    candidates.push({
      ruleId: "family-warm",
      tokens: familyTokens,
      voice: { ...currentVoice, manner: "friendly", verbosity: "detailed" },
    });
  }
  if (parsed.locale === "ar" && currentVoice.language === "english") {
    candidates.push({
      ruleId: "arabic-drafts",
      tokens: currentTokens,
      voice: { ...currentVoice, language: "arabic" },
    });
  }
  if (
    topPanel(parsed.panelUses) === "sophia" &&
    parsed.panelUses.sophia >= 3 &&
    currentTokens.density === "compact"
  ) {
    const next = readingTokens(currentTokens);
    candidates.push({
      ruleId: "reading-room",
      tokens: next,
      voice: currentVoice,
    });
  }

  for (const candidate of candidates) {
    if (cooledDown(decisions, candidate.ruleId, now)) continue;
    if (unchanged(currentTokens, currentVoice, candidate.tokens, candidate.voice)) continue;
    const next = proposal(candidate.ruleId, now, candidate.tokens, candidate.voice);
    if (next) return next;
  }
  return null;
}

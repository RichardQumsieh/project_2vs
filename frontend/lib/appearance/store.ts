import { z } from "zod";
import { parseSignals, type AdaptationDecision, type AppearanceProposal, type LocalSignals, type PanelId, PANEL_IDS, proposeAdaptation } from "./engine";
import { adaptiveThemeEnabled } from "./flag";
import { appearanceTokensSchema, parseAppearanceTokens, type AppearanceTokens } from "./schema";
import { defaultTokens } from "./tokens";
import { defaultVoice, parseVoice, sameVoice, voiceSchema, type VoicePreferences } from "./voice";

export const MAX_REVISIONS = 20;
export const MAX_DECISIONS = 40;

const userIdPattern = /^[A-Za-z0-9_-]{1,80}$/;

export function sanitizeUserId(userId: string | null | undefined): string {
  if (userId && userIdPattern.test(userId)) return userId;
  return "device";
}

export type RevisionSource = "default" | "user" | "proposal" | "reset";

export type AppearanceRevision = {
  id: string;
  at: string;
  source: RevisionSource;
  tokens: AppearanceTokens;
  voice: VoicePreferences;
};

export type AppearanceRecord = {
  version: 1;
  role: "manager" | "family";
  revisions: AppearanceRevision[];
  pending: AppearanceProposal | null;
  decisions: AdaptationDecision[];
};

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const revisionSchema = z
  .object({
    id: z.string().min(1).max(80),
    at: z.string().min(4).max(40),
    source: z.enum(["default", "user", "proposal", "reset"]),
    tokens: appearanceTokensSchema,
    voice: voiceSchema,
  })
  .strict();

const proposalSchema = z
  .object({
    id: z.string().regex(/^(evening-calm|morning-crisp|family-warm|arabic-drafts|reading-room):\d{4}-\d{2}-\d{2}$/),
    ruleId: z.enum(["evening-calm", "morning-crisp", "family-warm", "arabic-drafts", "reading-room"]),
    createdAt: z.string().min(4).max(40),
    tokens: appearanceTokensSchema,
    voice: voiceSchema,
  })
  .strict();

const recordSchema = z
  .object({
    version: z.literal(1),
    role: z.enum(["manager", "family"]),
    revisions: z.array(revisionSchema).min(1).max(MAX_REVISIONS),
    pending: proposalSchema.nullable(),
    decisions: z
      .array(
        z
          .object({
            ruleId: z.enum(["evening-calm", "morning-crisp", "family-warm", "arabic-drafts", "reading-room"]),
            at: z.string().min(4).max(40),
            decision: z.enum(["approved", "dismissed"]),
          })
          .strict(),
      )
      .max(MAX_DECISIONS),
  })
  .strict();

export function appearanceStorageKey(userId: string): string {
  return `sophia-appearance:v1:${sanitizeUserId(userId)}`;
}

export function panelStorageKey(userId: string): string {
  return `sophia-panel-uses:v1:${sanitizeUserId(userId)}`;
}

export function createDefaultRecord(now = new Date()): AppearanceRecord {
  return {
    version: 1,
    role: "manager",
    revisions: [
      {
        id: "baseline",
        at: now.toISOString(),
        source: "default",
        tokens: defaultTokens,
        voice: defaultVoice,
      },
    ],
    pending: null,
    decisions: [],
  };
}

export function activeRevision(record: AppearanceRecord): AppearanceRevision {
  return record.revisions[record.revisions.length - 1] ?? createDefaultRecord().revisions[0]!;
}

export function activeTokens(record: AppearanceRecord): AppearanceTokens {
  return activeRevision(record).tokens;
}

export function activeVoice(record: AppearanceRecord): VoicePreferences {
  return activeRevision(record).voice;
}

export function isCustomized(record: AppearanceRecord): boolean {
  return activeRevision(record).source !== "default";
}

function revalidate(record: AppearanceRecord): AppearanceRecord | null {
  const parsed = recordSchema.safeParse(record);
  if (!parsed.success) return null;
  const revisions: AppearanceRevision[] = [];
  for (const revision of parsed.data.revisions) {
    const tokens = parseAppearanceTokens(revision.tokens);
    const voice = parseVoice(revision.voice);
    if (!tokens.ok || !voice.ok) return null;
    revisions.push({ ...revision, tokens: tokens.tokens, voice: voice.voice });
  }
  let pending: AppearanceProposal | null = null;
  if (parsed.data.pending) {
    const tokens = parseAppearanceTokens(parsed.data.pending.tokens);
    const voice = parseVoice(parsed.data.pending.voice);
    if (!tokens.ok || !voice.ok) return null;
    pending = { ...parsed.data.pending, tokens: tokens.tokens, voice: voice.voice };
  }
  return { ...parsed.data, revisions, pending };
}

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

function browserStorage(): KeyValueStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAppearance(userId: string, storage: KeyValueStore | null = browserStorage()): AppearanceRecord {
  if (!storage) return createDefaultRecord();
  try {
    const raw = storage.getItem(appearanceStorageKey(userId));
    if (!raw) return createDefaultRecord();
    const validated = revalidate(JSON.parse(raw) as AppearanceRecord);
    return validated ?? createDefaultRecord();
  } catch {
    return createDefaultRecord();
  }
}

export function saveAppearance(
  userId: string,
  record: AppearanceRecord,
  storage: KeyValueStore | null = browserStorage(),
): boolean {
  const validated = revalidate(record);
  if (!validated || !storage) return false;
  try {
    storage.setItem(appearanceStorageKey(userId), JSON.stringify(validated));
    return true;
  } catch {
    return false;
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `rev-${Date.now().toString(36)}`;
}

function pushRevision(
  record: AppearanceRecord,
  source: RevisionSource,
  tokens: AppearanceTokens,
  voice: VoicePreferences,
  now: Date,
): AppearanceRecord {
  const current = activeRevision(record);
  if (
    source !== "reset" &&
    JSON.stringify(current.tokens) === JSON.stringify(tokens) &&
    sameVoice(current.voice, voice)
  ) {
    return record;
  }
  const revision: AppearanceRevision = {
    id: createId(),
    at: now.toISOString(),
    source,
    tokens,
    voice,
  };
  return {
    ...record,
    revisions: [...record.revisions, revision].slice(-MAX_REVISIONS),
  };
}

export function commitAppearance(
  record: AppearanceRecord,
  tokens: AppearanceTokens,
  voice: VoicePreferences,
  source: Exclude<RevisionSource, "default">,
  now = new Date(),
): { ok: true; record: AppearanceRecord } | { ok: false; reason: "invalid" } {
  const parsedTokens = parseAppearanceTokens(tokens);
  const parsedVoice = parseVoice(voice);
  if (!parsedTokens.ok || !parsedVoice.ok) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    record: pushRevision(record, source, parsedTokens.tokens, parsedVoice.voice, now),
  };
}

export function undoAppearance(record: AppearanceRecord): AppearanceRecord {
  if (record.revisions.length < 2) return record;
  return { ...record, revisions: record.revisions.slice(0, -1) };
}

export function resetAppearance(record: AppearanceRecord, now = new Date()): AppearanceRecord {
  const current = activeRevision(record);
  if (
    JSON.stringify(current.tokens) === JSON.stringify(defaultTokens) &&
    sameVoice(current.voice, defaultVoice) &&
    record.role === "manager"
  ) {
    return { ...record, pending: null };
  }
  const next = pushRevision(record, "reset", defaultTokens, defaultVoice, now);
  return { ...next, role: "manager", pending: null };
}

export function approveProposal(record: AppearanceRecord, now = new Date()): AppearanceRecord {
  if (!record.pending) return record;
  const committed = commitAppearance(
    record,
    record.pending.tokens,
    record.pending.voice,
    "proposal",
    now,
  );
  if (!committed.ok) return { ...record, pending: null };
  return {
    ...committed.record,
    pending: null,
    decisions: [
      ...record.decisions,
      { ruleId: record.pending.ruleId, at: now.toISOString(), decision: "approved" as const },
    ].slice(-MAX_DECISIONS),
  };
}

export function dismissProposal(record: AppearanceRecord, now = new Date()): AppearanceRecord {
  if (!record.pending) return record;
  return {
    ...record,
    pending: null,
    decisions: [
      ...record.decisions,
      { ruleId: record.pending.ruleId, at: now.toISOString(), decision: "dismissed" as const },
    ].slice(-MAX_DECISIONS),
  };
}

export function setAppearanceRole(record: AppearanceRecord, role: "manager" | "family"): AppearanceRecord {
  if (record.role === role) return record;
  return { ...record, role };
}

export function syncProposal(
  record: AppearanceRecord,
  signals: LocalSignals,
  now = new Date(),
): AppearanceRecord {
  if (!parseSignals(signals)) return record;
  const next = proposeAdaptation(
    activeTokens(record),
    activeVoice(record),
    signals,
    record.decisions,
    now,
  );
  if (!next && !record.pending) return record;
  if (
    next &&
    record.pending &&
    record.pending.id === next.id &&
    JSON.stringify(record.pending.tokens) === JSON.stringify(next.tokens) &&
    sameVoice(record.pending.voice, next.voice)
  ) {
    return record;
  }
  if (!next && record.pending) return { ...record, pending: null };
  if (!next) return record;
  return { ...record, pending: next };
}

export function loadPanelUses(
  userId: string,
  storage: KeyValueStore | null = browserStorage(),
): Record<PanelId, number> {
  const empty = { inbox: 0, sophia: 0, settings: 0, integrations: 0 };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(panelStorageKey(userId));
    if (!raw) return empty;
    const parsed = z
      .object({
        inbox: z.number().int().min(0).max(10_000),
        sophia: z.number().int().min(0).max(10_000),
        settings: z.number().int().min(0).max(10_000),
        integrations: z.number().int().min(0).max(10_000),
      })
      .strict()
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

export function recordPanelUse(
  userId: string,
  panel: PanelId,
  storage: KeyValueStore | null = browserStorage(),
): Record<PanelId, number> {
  if (!PANEL_IDS.includes(panel)) return loadPanelUses(userId, storage);
  const current = loadPanelUses(userId, storage);
  const next = { ...current, [panel]: Math.min(10_000, current[panel] + 1) };
  if (storage) {
    try {
      storage.setItem(panelStorageKey(userId), JSON.stringify(next));
    } catch {
      return current;
    }
  }
  return next;
}

export function draftVoiceForUser(userId: string | null | undefined): VoicePreferences | undefined {
  if (!adaptiveThemeEnabled() || !userId) return undefined;
  return activeVoice(loadAppearance(userId));
}

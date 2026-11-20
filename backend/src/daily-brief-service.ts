import {
  briefConnectionsMissing,
  briefIsDue,
  briefLogFields,
  composeDailyBrief,
  defaultBriefPreference,
  parseBriefPreference,
  zonedParts,
  type BriefAssistant,
  type BriefPreference,
  type BriefSource,
  type DailyBriefDocument,
} from "./daily-brief.js";

export type BriefPendingReason = "before_brief_time" | "not_connected";

export type StoredBrief = {
  id: string;
  ownerUserId: string;
  localDate: string;
  document: DailyBriefDocument;
};

export type BriefCandidate = {
  userId: string;
  preference: BriefPreference;
};

export type DailyBriefRepository = {
  getPreference(userId: string): Promise<BriefPreference | null>;
  savePreference(userId: string, preference: BriefPreference): Promise<BriefPreference>;
  findBrief(userId: string, localDate: string): Promise<StoredBrief | null>;
  saveBrief(input: {
    ownerUserId: string;
    localDate: string;
    document: DailyBriefDocument;
  }): Promise<StoredBrief>;
  listCandidates(): Promise<BriefCandidate[]>;
  loadSources(userId: string, now: Date, preference: BriefPreference): Promise<BriefSource>;
};

export type BriefActivity = (
  summary: "Prepared the daily brief" | "Updated the daily brief schedule",
  action: "BUTTON_ACTION" | "SETTING_CHANGED",
) => Promise<void>;

export type BriefServiceSuccess = {
  ok: true;
  status: 200;
  body: {
    enabled: true;
    preference: BriefPreference;
    brief: DailyBriefDocument | null;
    pendingReason: BriefPendingReason | null;
  };
};

export type BriefServiceFailure = {
  ok: false;
  status: 400 | 404;
  error: string;
  code: string;
};

const disabled: BriefServiceFailure = {
  ok: false,
  status: 404,
  error: "Daily brief is disabled on this server.",
  code: "daily_brief_disabled",
};

async function ensurePreference(repo: DailyBriefRepository, userId: string) {
  const existing = await repo.getPreference(userId);
  if (existing) return existing;
  return repo.savePreference(userId, defaultBriefPreference());
}

async function generate(input: {
  repo: DailyBriefRepository;
  userId: string;
  now: Date;
  preference: BriefPreference;
  assistant: BriefAssistant;
  sourceKind: "morning" | "on_demand";
  source?: BriefSource;
  recordActivity?: BriefActivity;
}): Promise<DailyBriefDocument | "not_connected"> {
  const source = input.source ?? await input.repo.loadSources(input.userId, input.now, input.preference);
  if (briefConnectionsMissing(source)) return "not_connected";
  const document = await composeDailyBrief({
    now: input.now,
    preference: input.preference,
    source,
    sourceKind: input.sourceKind,
    assistant: input.assistant,
  });
  await input.repo.saveBrief({
    ownerUserId: input.userId,
    localDate: document.localDate,
    document,
  });
  await input.recordActivity?.("Prepared the daily brief", "BUTTON_ACTION");
  return document;
}

export async function readDailyBrief(input: {
  enabled: boolean;
  userId: string;
  now: Date;
  repo: DailyBriefRepository;
  assistant: BriefAssistant;
  recordActivity?: BriefActivity;
}): Promise<BriefServiceSuccess | BriefServiceFailure> {
  if (!input.enabled) return disabled;
  const preference = await ensurePreference(input.repo, input.userId);
  const local = zonedParts(input.now, preference.timeZone);
  const existing = await input.repo.findBrief(input.userId, local.date);
  if (existing) {
    return {
      ok: true,
      status: 200,
      body: {
        enabled: true,
        preference,
        brief: existing.document,
        pendingReason: null,
      },
    };
  }
  const source = await input.repo.loadSources(input.userId, input.now, preference);
  if (briefConnectionsMissing(source)) {
    return {
      ok: true,
      status: 200,
      body: {
        enabled: true,
        preference,
        brief: null,
        pendingReason: "not_connected",
      },
    };
  }
  if (!briefIsDue({
    now: input.now,
    timeZone: preference.timeZone,
    briefTime: preference.briefTime,
    generatedForDate: null,
  })) {
    return {
      ok: true,
      status: 200,
      body: {
        enabled: true,
        preference,
        brief: null,
        pendingReason: "before_brief_time",
      },
    };
  }
  const brief = await generate({
    repo: input.repo,
    userId: input.userId,
    now: input.now,
    preference,
    assistant: input.assistant,
    sourceKind: "morning",
    source,
    recordActivity: input.recordActivity,
  });
  if (brief === "not_connected") {
    return {
      ok: true,
      status: 200,
      body: {
        enabled: true,
        preference,
        brief: null,
        pendingReason: "not_connected",
      },
    };
  }
  return {
    ok: true,
    status: 200,
    body: { enabled: true, preference, brief, pendingReason: null },
  };
}

export async function generateDailyBriefNow(input: {
  enabled: boolean;
  userId: string;
  now: Date;
  repo: DailyBriefRepository;
  assistant: BriefAssistant;
  recordActivity?: BriefActivity;
}): Promise<BriefServiceSuccess | BriefServiceFailure> {
  if (!input.enabled) return disabled;
  const preference = await ensurePreference(input.repo, input.userId);
  const brief = await generate({
    repo: input.repo,
    userId: input.userId,
    now: input.now,
    preference,
    assistant: input.assistant,
    sourceKind: "on_demand",
    recordActivity: input.recordActivity,
  });
  if (brief === "not_connected") {
    return {
      ok: true,
      status: 200,
      body: {
        enabled: true,
        preference,
        brief: null,
        pendingReason: "not_connected",
      },
    };
  }
  return {
    ok: true,
    status: 200,
    body: { enabled: true, preference, brief, pendingReason: null },
  };
}

export async function saveDailyBriefPreference(input: {
  enabled: boolean;
  userId: string;
  body: unknown;
  repo: DailyBriefRepository;
  recordActivity?: BriefActivity;
}): Promise<BriefServiceSuccess | BriefServiceFailure> {
  if (!input.enabled) return disabled;
  const parsed = parseBriefPreference(input.body);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error, code: "invalid_brief_preference" };
  }
  const preference = await input.repo.savePreference(input.userId, parsed.preference);
  await input.recordActivity?.("Updated the daily brief schedule", "SETTING_CHANGED");
  const now = new Date();
  const local = zonedParts(now, preference.timeZone);
  const existing = await input.repo.findBrief(input.userId, local.date);
  const source = existing ? null : await input.repo.loadSources(input.userId, now, preference);
  const pendingReason = existing
    ? null
    : source && briefConnectionsMissing(source)
      ? "not_connected"
      : "before_brief_time";
  return {
    ok: true,
    status: 200,
    body: {
      enabled: true,
      preference,
      brief: existing?.document ?? null,
      pendingReason,
    },
  };
}

export async function runDueDailyBriefs(input: {
  enabled: boolean;
  now: Date;
  repo: DailyBriefRepository;
  assistantFor: (userId: string) => Promise<BriefAssistant>;
  recordActivity?: (userId: string) => Promise<void>;
  /** When set, skip accounts whose workspace plan does not include the brief. */
  allowUser?: (userId: string) => Promise<boolean>;
}) {
  if (!input.enabled) return { prepared: 0, skipped: 0 };
  const candidates = await input.repo.listCandidates();
  let prepared = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates.slice(0, 500)) {
    try {
      if (input.allowUser && !(await input.allowUser(candidate.userId))) {
        skipped += 1;
        continue;
      }
      const local = zonedParts(input.now, candidate.preference.timeZone);
      const existing = await input.repo.findBrief(candidate.userId, local.date);
      const due = briefIsDue({
        now: input.now,
        timeZone: candidate.preference.timeZone,
        briefTime: candidate.preference.briefTime,
        generatedForDate: existing ? local.date : null,
      });
      if (!due) {
        skipped += 1;
        continue;
      }
      const source = await input.repo.loadSources(candidate.userId, input.now, candidate.preference);
      if (briefConnectionsMissing(source)) {
        skipped += 1;
        continue;
      }
      const assistant = await input.assistantFor(candidate.userId);
      const brief = await generate({
        repo: input.repo,
        userId: candidate.userId,
        now: input.now,
        preference: candidate.preference,
        assistant,
        sourceKind: "morning",
        source,
      });
      if (brief === "not_connected") {
        skipped += 1;
        continue;
      }
      await input.recordActivity?.(candidate.userId);
      prepared += 1;
    } catch {
      failed += 1;
    }
  }
  return { prepared, skipped, failed };
}

export function publicBriefLog(document: DailyBriefDocument) {
  return briefLogFields(document);
}

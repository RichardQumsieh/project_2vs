import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type RadarFindingCategory =
  | "commitment"
  | "deadline"
  | "decision"
  | "question";

export type RadarFindingStatus =
  | "pending"
  | "accepted"
  | "dismissed"
  | "snoozed";

export type RadarCommittedBy = "self" | "peer" | "unknown";

export type RadarFinding = {
  id: string;
  conversationId: string;
  messageIds: string[];
  category: RadarFindingCategory;
  title: string;
  excerpt: string;
  dueAt?: string;
  committedBy: RadarCommittedBy;
  status: RadarFindingStatus;
  snoozeUntil?: string;
  taskDraftId?: string;
  createdAt: string;
  updatedAt: string;
};

export type RadarTaskDraft = {
  id: string;
  findingId?: string;
  conversationId?: string;
  title: string;
  dueAt?: string;
  status: "open" | "done";
  createdAt: string;
  updatedAt: string;
};

export type RadarStoreState = {
  version: 1;
  allowedConversationIds: string[];
  findings: RadarFinding[];
  taskDrafts: RadarTaskDraft[];
};

const DB_NAME = "private-messenger-radar";
const DB_VERSION = 1;
const maxFindings = 200;
const maxTaskDrafts = 200;
const maxTitleCharacters = 160;
const maxExcerptCharacters = 280;

/** IndexedDB object-store key — one Radar state blob per signed-in user. */
export function radarStoreUserKey(userId: string) {
  return userId.trim();
}

interface RadarDB extends DBSchema {
  stores: {
    key: string;
    value: RadarStoreState;
  };
}

export const emptyRadarStoreState = (): RadarStoreState => ({
  version: 1,
  allowedConversationIds: [],
  findings: [],
  taskDrafts: [],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(value: string, max: number) {
  return value.replace(/\s+/g, " ").replace(/\u0000/g, "").trim().slice(0, max);
}

function parseFinding(value: unknown): RadarFinding | null {
  if (!isRecord(value)) {
    return null;
  }
  const category = value.category;
  const status = value.status;
  const committedBy = value.committedBy;
  const title =
    typeof value.title === "string"
      ? normalizeText(value.title, maxTitleCharacters)
      : "";
  const excerpt =
    typeof value.excerpt === "string"
      ? normalizeText(value.excerpt, maxExcerptCharacters)
      : "";
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 80 ||
    typeof value.conversationId !== "string" ||
    !value.conversationId ||
    !Array.isArray(value.messageIds) ||
    (category !== "commitment" &&
      category !== "deadline" &&
      category !== "decision" &&
      category !== "question") ||
    !title ||
    !excerpt ||
    (committedBy !== "self" &&
      committedBy !== "peer" &&
      committedBy !== "unknown") ||
    (status !== "pending" &&
      status !== "accepted" &&
      status !== "dismissed" &&
      status !== "snoozed") ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  const messageIds = value.messageIds
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .slice(0, 12);
  if (!messageIds.length) {
    return null;
  }
  return {
    id: value.id,
    conversationId: value.conversationId.slice(0, 80),
    messageIds,
    category,
    title,
    excerpt,
    dueAt:
      typeof value.dueAt === "string" && value.dueAt.length <= 40
        ? value.dueAt
        : undefined,
    committedBy,
    status,
    snoozeUntil:
      typeof value.snoozeUntil === "string" && value.snoozeUntil.length <= 40
        ? value.snoozeUntil
        : undefined,
    taskDraftId:
      typeof value.taskDraftId === "string" && value.taskDraftId.length <= 80
        ? value.taskDraftId
        : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseTaskDraft(value: unknown): RadarTaskDraft | null {
  if (!isRecord(value)) {
    return null;
  }
  const title =
    typeof value.title === "string"
      ? normalizeText(value.title, maxTitleCharacters)
      : "";
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 80 ||
    !title ||
    (value.status !== "open" && value.status !== "done") ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    findingId:
      typeof value.findingId === "string" && value.findingId.length <= 80
        ? value.findingId
        : undefined,
    conversationId:
      typeof value.conversationId === "string" &&
      value.conversationId.length <= 80
        ? value.conversationId
        : undefined,
    title,
    dueAt:
      typeof value.dueAt === "string" && value.dueAt.length <= 40
        ? value.dueAt
        : undefined,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseRadarStoreState(value: unknown): RadarStoreState {
  if (!isRecord(value)) {
    return emptyRadarStoreState();
  }
  const allowedConversationIds = Array.isArray(value.allowedConversationIds)
    ? [
        ...new Set(
          value.allowedConversationIds.filter(
            (id): id is string =>
              typeof id === "string" && id.length > 0 && id.length <= 80,
          ),
        ),
      ].slice(0, 200)
    : [];
  const findings = Array.isArray(value.findings)
    ? value.findings
        .map(parseFinding)
        .filter((finding): finding is RadarFinding => Boolean(finding))
        .slice(0, maxFindings)
    : [];
  const taskDrafts = Array.isArray(value.taskDrafts)
    ? value.taskDrafts
        .map(parseTaskDraft)
        .filter((draft): draft is RadarTaskDraft => Boolean(draft))
        .slice(0, maxTaskDrafts)
    : [];
  return {
    version: 1,
    allowedConversationIds,
    findings,
    taskDrafts,
  };
}

export function isConversationAllowed(
  state: RadarStoreState,
  conversationId: string,
) {
  return state.allowedConversationIds.includes(conversationId);
}

export function setConversationAllowed(
  state: RadarStoreState,
  conversationId: string,
  allowed: boolean,
): RadarStoreState {
  const nextIds = new Set(state.allowedConversationIds);
  if (allowed) {
    nextIds.add(conversationId);
  } else {
    nextIds.delete(conversationId);
  }
  return {
    ...state,
    allowedConversationIds: [...nextIds].slice(0, 200),
  };
}

export function upsertFindings(
  state: RadarStoreState,
  findings: RadarFinding[],
): RadarStoreState {
  const byId = new Map(state.findings.map((finding) => [finding.id, finding]));
  for (const finding of findings) {
    const existing = byId.get(finding.id);
    if (existing && existing.status !== "pending" && existing.status !== "snoozed") {
      continue;
    }
    if (
      existing &&
      (existing.status === "pending" || existing.status === "snoozed")
    ) {
      byId.set(finding.id, {
        ...finding,
        status: existing.status,
        snoozeUntil: existing.snoozeUntil,
        taskDraftId: existing.taskDraftId,
        createdAt: existing.createdAt,
        updatedAt: finding.updatedAt,
      });
      continue;
    }
    byId.set(finding.id, finding);
  }
  return {
    ...state,
    findings: [...byId.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, maxFindings),
  };
}

export function listPendingFindings(
  state: RadarStoreState,
  conversationId?: string | null,
  now = new Date(),
) {
  const nowMs = now.getTime();
  return state.findings.filter((finding) => {
    if (conversationId && finding.conversationId !== conversationId) {
      return false;
    }
    if (finding.status === "pending") {
      return true;
    }
    if (finding.status === "snoozed") {
      if (!finding.snoozeUntil) {
        return true;
      }
      const until = Date.parse(finding.snoozeUntil);
      return Number.isFinite(until) ? until <= nowMs : true;
    }
    return false;
  });
}

export function updateFinding(
  state: RadarStoreState,
  findingId: string,
  update: Partial<
    Pick<
      RadarFinding,
      "title" | "dueAt" | "status" | "snoozeUntil" | "taskDraftId" | "updatedAt"
    >
  >,
): RadarStoreState {
  return {
    ...state,
    findings: state.findings.map((finding) =>
      finding.id === findingId
        ? {
            ...finding,
            ...update,
            title:
              typeof update.title === "string"
                ? normalizeText(update.title, maxTitleCharacters) || finding.title
                : finding.title,
            updatedAt: update.updatedAt ?? new Date().toISOString(),
          }
        : finding,
    ),
  };
}

export function acceptFindingAsTaskDraft(
  state: RadarStoreState,
  findingId: string,
  options: {
    title?: string;
    dueAt?: string;
    id?: string;
    now?: Date;
  } = {},
): RadarStoreState {
  const finding = state.findings.find((item) => item.id === findingId);
  if (!finding) {
    throw new Error("That Radar finding is no longer available.");
  }
  const now = (options.now ?? new Date()).toISOString();
  const title = normalizeText(
    options.title ?? finding.title,
    maxTitleCharacters,
  );
  if (!title) {
    throw new Error("A task title is required.");
  }
  const draft: RadarTaskDraft = {
    id: options.id ?? crypto.randomUUID(),
    findingId: finding.id,
    conversationId: finding.conversationId,
    title,
    dueAt: options.dueAt ?? finding.dueAt,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...updateFinding(state, findingId, {
      status: "accepted",
      taskDraftId: draft.id,
      title,
      dueAt: draft.dueAt,
      snoozeUntil: undefined,
      updatedAt: now,
    }),
    taskDrafts: [draft, ...state.taskDrafts]
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.id === item.id) === index,
      )
      .slice(0, maxTaskDrafts),
  };
}

export function dismissFinding(
  state: RadarStoreState,
  findingId: string,
  now = new Date(),
): RadarStoreState {
  return updateFinding(state, findingId, {
    status: "dismissed",
    snoozeUntil: undefined,
    updatedAt: now.toISOString(),
  });
}

export function snoozeFinding(
  state: RadarStoreState,
  findingId: string,
  until: string,
  now = new Date(),
): RadarStoreState {
  const parsed = Date.parse(until);
  if (!Number.isFinite(parsed)) {
    throw new Error("A valid snooze time is required.");
  }
  return updateFinding(state, findingId, {
    status: "snoozed",
    snoozeUntil: new Date(parsed).toISOString(),
    updatedAt: now.toISOString(),
  });
}

export function updateTaskDraft(
  state: RadarStoreState,
  taskDraftId: string,
  update: Partial<Pick<RadarTaskDraft, "title" | "dueAt" | "status">>,
  now = new Date(),
): RadarStoreState {
  const timestamp = now.toISOString();
  const drafts = state.taskDrafts.map((draft) => {
    if (draft.id !== taskDraftId) {
      return draft;
    }
    const title =
      typeof update.title === "string"
        ? normalizeText(update.title, maxTitleCharacters) || draft.title
        : draft.title;
    return {
      ...draft,
      title,
      dueAt:
        update.dueAt !== undefined
          ? update.dueAt?.trim() || undefined
          : draft.dueAt,
      status: update.status ?? draft.status,
      updatedAt: timestamp,
    };
  });
  if (!drafts.some((draft) => draft.id === taskDraftId)) {
    throw new Error("That local task draft is no longer available.");
  }
  const draft = drafts.find((item) => item.id === taskDraftId);
  const findings = draft?.findingId
    ? state.findings.map((finding) =>
        finding.id === draft.findingId
          ? {
              ...finding,
              title: draft.title,
              dueAt: draft.dueAt,
              updatedAt: timestamp,
            }
          : finding,
      )
    : state.findings;
  return {
    ...state,
    findings,
    taskDrafts: drafts,
  };
}

export function createFollowUpTaskDraft(
  state: RadarStoreState,
  options: {
    title: string;
    dueAt?: string;
    conversationId?: string;
    findingId?: string;
    id?: string;
    now?: Date;
  },
): RadarStoreState {
  const title = normalizeText(options.title, maxTitleCharacters);
  if (!title) {
    throw new Error("A follow-up title is required.");
  }
  const now = (options.now ?? new Date()).toISOString();
  const draft: RadarTaskDraft = {
    id: options.id ?? crypto.randomUUID(),
    findingId: options.findingId,
    conversationId: options.conversationId,
    title,
    dueAt: options.dueAt?.trim() || undefined,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    taskDrafts: [draft, ...state.taskDrafts].slice(0, maxTaskDrafts),
  };
}

let dbPromise: Promise<IDBPDatabase<RadarDB>> | undefined;

async function getRadarDb() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is unavailable in this environment.");
  }
  if (!dbPromise) {
    dbPromise = openDB<RadarDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("stores")) {
          db.createObjectStore("stores");
        }
      },
    });
  }
  return dbPromise;
}

export async function loadRadarStore(userId: string): Promise<RadarStoreState> {
  const key = radarStoreUserKey(userId);
  if (!key) {
    return emptyRadarStoreState();
  }
  try {
    const db = await getRadarDb();
    const stored = await db.get("stores", key);
    return parseRadarStoreState(stored);
  } catch {
    return emptyRadarStoreState();
  }
}

export async function saveRadarStore(
  userId: string,
  state: RadarStoreState,
): Promise<boolean> {
  const key = radarStoreUserKey(userId);
  if (!key) {
    return false;
  }
  try {
    const db = await getRadarDb();
    await db.put("stores", parseRadarStoreState(state), key);
    return true;
  } catch {
    return false;
  }
}

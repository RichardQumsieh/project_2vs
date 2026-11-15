import type { RadarTaskDraft } from "./radar-store";

export type SyncedServerTask = {
  id: string;
  title: string;
  dueAt: string | null;
  status: "OPEN" | "DONE" | "DISMISSED";
  source: "MANUAL" | "RADAR";
  clientDraftId: string | null;
  conversationId: string | null;
};

export type CreateTaskPayload = {
  title: string;
  dueAt?: string;
  source: "RADAR";
  clientDraftId: string;
  conversationId?: string;
  status: "OPEN" | "DONE" | "DISMISSED";
};

export function taskDraftToCreatePayload(
  draft: RadarTaskDraft,
): CreateTaskPayload {
  const title = draft.title.trim().slice(0, 160);
  if (!title) {
    throw new Error("A task title is required to sync.");
  }
  return {
    title,
    dueAt: draft.dueAt,
    source: "RADAR",
    clientDraftId: draft.id,
    conversationId: draft.conversationId,
    status: draft.status === "done" ? "DONE" : "OPEN",
  };
}

export function listUnsyncedAcceptedDrafts(
  drafts: RadarTaskDraft[],
  syncedClientDraftIds: Iterable<string>,
) {
  const synced = new Set(syncedClientDraftIds);
  return drafts.filter(
    (draft) =>
      draft.status === "open" &&
      Boolean(draft.findingId) &&
      !synced.has(draft.id),
  );
}

export async function syncAcceptedTaskDraft(
  draft: RadarTaskDraft,
  createTask: (
    payload: CreateTaskPayload,
  ) => Promise<{ task: SyncedServerTask; deduped?: boolean }>,
) {
  const payload = taskDraftToCreatePayload(draft);
  // Only structured accepted-task fields leave the device — never findings or chat plaintext.
  return createTask(payload);
}

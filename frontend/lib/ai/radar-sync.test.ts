import { describe, expect, it, vi } from "vitest";
import {
  listUnsyncedAcceptedDrafts,
  syncAcceptedTaskDraft,
  taskDraftToCreatePayload,
} from "./radar-sync";
import type { RadarTaskDraft } from "./radar-store";

const draft: RadarTaskDraft = {
  id: "draft-1",
  findingId: "finding-1",
  conversationId: "11111111-1111-1111-1111-111111111111",
  title: "Send proposal",
  dueAt: "2026-11-16",
  status: "open",
  createdAt: "2026-11-15T12:00:00.000Z",
  updatedAt: "2026-11-15T12:00:00.000Z",
};

describe("radar accepted-task sync", () => {
  it("maps local drafts to structured payloads without excerpts", () => {
    const payload = taskDraftToCreatePayload(draft);
    expect(payload).toEqual({
      title: "Send proposal",
      dueAt: "2026-11-16",
      source: "RADAR",
      clientDraftId: "draft-1",
      conversationId: "11111111-1111-1111-1111-111111111111",
      status: "OPEN",
    });
    expect(JSON.stringify(payload)).not.toContain("I'll send");
    expect(Object.keys(payload).sort()).toEqual([
      "clientDraftId",
      "conversationId",
      "dueAt",
      "source",
      "status",
      "title",
    ]);
  });

  it("skips drafts that already have a server clientDraftId mapping", () => {
    expect(listUnsyncedAcceptedDrafts([draft], [])).toHaveLength(1);
    expect(listUnsyncedAcceptedDrafts([draft], ["draft-1"])).toHaveLength(0);
  });

  it("posts only the create payload through the injected API", async () => {
    const createTask = vi.fn().mockResolvedValue({
      task: {
        id: "server-1",
        title: draft.title,
        dueAt: draft.dueAt ?? null,
        status: "OPEN",
        source: "RADAR",
        clientDraftId: draft.id,
        conversationId: draft.conversationId ?? null,
      },
      deduped: false,
    });
    await syncAcceptedTaskDraft(draft, createTask);
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "RADAR",
        clientDraftId: "draft-1",
        title: "Send proposal",
      }),
    );
  });
});

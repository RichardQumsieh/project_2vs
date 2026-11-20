import type { BriefSuggestedAction } from "./types";

export type BriefApprovalClients = {
  createEmailDraft: (
    provider: "gmail" | "outlook-mail",
    body: { to: string[]; subject: string; body: string },
    proposalId: string,
  ) => Promise<unknown>;
  updateCalendarEvent: (
    provider: "google" | "outlook",
    externalEventId: string,
    body: { title: string; startsAt: string; endsAt: string; allDay?: boolean },
    proposalId: string,
  ) => Promise<unknown>;
  deleteCalendarEvent: (
    provider: "google" | "outlook",
    eventId: string,
    proposalId: string,
  ) => Promise<unknown>;
};

/**
 * Sends one already-reviewed suggestion through the existing
 * propose-then-approve mail and calendar path. It does not call send.
 */
export async function approveBriefAction(
  action: BriefSuggestedAction,
  clients: BriefApprovalClients,
) {
  const approval = action.approval;
  if (approval.action === "save_draft") {
    return clients.createEmailDraft(
      approval.provider,
      approval.payload,
      approval.idempotencyKey,
    );
  }
  if (approval.action === "reschedule_event") {
    return clients.updateCalendarEvent(
      approval.provider,
      approval.payload.externalEventId,
      {
        title: approval.payload.title,
        startsAt: approval.payload.startsAt,
        endsAt: approval.payload.endsAt,
        allDay: approval.payload.allDay,
      },
      approval.idempotencyKey,
    );
  }
  return clients.deleteCalendarEvent(
    approval.provider,
    approval.payload.eventId,
    approval.idempotencyKey,
  );
}

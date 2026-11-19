import { denyUnlessOwner } from "./task-authorization.js";

export const wiredActivityActions = [
  "LOGIN",
  "CLOUD_CONSENT_GRANTED",
  "CLOUD_CONSENT_WITHDRAWN",
  "SETTING_CHANGED",
  "EMAIL_SENT",
  "EMAIL_DRAFT_SAVED",
  "CALENDAR_DELETE_APPROVED",
  "CALENDAR_RESCHEDULE_APPROVED",
  "BUTTON_ACTION",
] as const;

export type WiredActivityAction = (typeof wiredActivityActions)[number];

const wired = new Set<string>(wiredActivityActions);

const exportEventKeys = [
  "action",
  "actor",
  "actorUserId",
  "id",
  "occurredAt",
  "subjectId",
  "subjectKind",
  "summary",
] as const;

export type ActivityExportEvent = {
  id: string;
  actorUserId: string;
  actor: string;
  occurredAt: string;
  action: string;
  summary: string;
  subjectKind: string | null;
  subjectId: string | null;
};

function clipLabel(value: string, max: number) {
  const cleaned = value.replace(/[\r\n]+/g, " ").trim();
  if (!cleaned || cleaned.length > max) return null;
  return cleaned;
}

export function activityListFilter(sessionUserId: string) {
  return { ownerUserId: sessionUserId };
}

export function activityWriteOwner(sessionUserId: string) {
  return {
    ownerUserId: sessionUserId,
    actorUserId: sessionUserId,
  };
}

export function activityReadDecision(
  ownerUserId: string | null | undefined,
  sessionUserId: string,
) {
  return denyUnlessOwner({ ownerUserId, sessionUserId });
}

export function sanitizeActivityWrite(input: {
  ownerUserId: string;
  actorUserId: string;
  actorLabel: string;
  action: string;
  summary: string;
  subjectKind?: string | null;
  subjectId?: string | null;
}) {
  if (input.ownerUserId !== input.actorUserId) {
    return { ok: false as const, error: "Activity actor must be the account owner." };
  }
  if (!wired.has(input.action)) {
    return { ok: false as const, error: "That activity action is not recorded." };
  }
  const actorLabel = clipLabel(input.actorLabel, 80);
  const summary = clipLabel(input.summary, 160);
  if (!actorLabel || !summary) {
    return { ok: false as const, error: "Activity metadata is empty or too long." };
  }
  const subjectKind = input.subjectKind ? clipLabel(input.subjectKind, 32) : null;
  const subjectId = input.subjectId ? clipLabel(input.subjectId, 80) : null;
  if (input.subjectKind && !subjectKind) {
    return { ok: false as const, error: "Activity subject is too long." };
  }
  if (input.subjectId && !subjectId) {
    return { ok: false as const, error: "Activity subject is too long." };
  }
  return {
    ok: true as const,
    data: {
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      actorLabel,
      action: input.action as WiredActivityAction,
      summary,
      subjectKind,
      subjectId,
    },
  };
}

export function toActivityExportEvent(event: {
  id: string;
  actorUserId: string;
  actorLabel: string;
  occurredAt: string;
  action: string;
  summary: string;
  subjectKind: string | null;
  subjectId: string | null;
}): ActivityExportEvent {
  return {
    id: event.id,
    actorUserId: event.actorUserId,
    actor: event.actorLabel,
    occurredAt: event.occurredAt,
    action: event.action,
    summary: event.summary,
    subjectKind: event.subjectKind,
    subjectId: event.subjectId,
  };
}

export function toActivityExport(input: {
  ownerUserId: string;
  exportedAt: string;
  events: Array<Parameters<typeof toActivityExportEvent>[0]>;
}) {
  return {
    version: 1 as const,
    exportedAt: input.exportedAt,
    ownerUserId: input.ownerUserId,
    events: input.events.map((event) => toActivityExportEvent(event)),
  };
}

export function activityExportEventKeys() {
  return [...exportEventKeys];
}

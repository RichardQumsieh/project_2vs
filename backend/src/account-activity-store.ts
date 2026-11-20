import type { AccountActivityAction } from "@prisma/client";
import { sanitizeActivityWrite } from "./account-activity.js";
import { prisma } from "./db.js";
import { workspaceAuditEvents } from "./workspace-activity.js";

export async function tryRecordAccountActivity(input: {
  ownerUserId: string;
  actorUserId: string;
  actorLabel: string;
  action: string;
  summary: string;
  subjectKind?: string | null;
  subjectId?: string | null;
}) {
  const sanitized = sanitizeActivityWrite(input);
  if (!sanitized.ok) return;
  try {
    await prisma.accountActivityEvent.create({
      data: {
        ownerUserId: sanitized.data.ownerUserId,
        actorUserId: sanitized.data.actorUserId,
        actorLabel: sanitized.data.actorLabel,
        action: sanitized.data.action as AccountActivityAction,
        summary: sanitized.data.summary,
        subjectKind: sanitized.data.subjectKind,
        subjectId: sanitized.data.subjectId,
      },
    });
  } catch {
    // A failed activity write must not block sign-in or an already approved action.
  }
}

/** Server-only workspace audit. The actor can differ from the log owner. */
export async function tryRecordWorkspaceActivity(input: Parameters<typeof workspaceAuditEvents>[0]) {
  const built = workspaceAuditEvents(input);
  if (!built.ok) return;
  try {
    await prisma.accountActivityEvent.createMany({ data: built.events });
  } catch {
    // A failed activity write must not undo a workspace change that already happened.
  }
}

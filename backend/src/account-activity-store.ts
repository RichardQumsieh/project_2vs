import type { AccountActivityAction } from "@prisma/client";
import { sanitizeActivityWrite } from "./account-activity.js";
import { prisma } from "./db.js";

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

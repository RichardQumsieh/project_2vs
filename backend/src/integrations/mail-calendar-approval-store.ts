import { Prisma, type IntegrationWriteAction, type IntegrationWriteStatus } from "@prisma/client";
import { prisma } from "../db.js";
import type {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalStore,
  MailCalendarAction,
  MailCalendarProvider,
} from "./mail-calendar-approval.js";

const actionToDb: Record<MailCalendarAction, IntegrationWriteAction> = {
  send_email: "SEND_EMAIL",
  save_draft: "SAVE_DRAFT",
  reschedule_event: "RESCHEDULE_EVENT",
  delete_event: "DELETE_EVENT",
};

const dbToAction: Record<IntegrationWriteAction, MailCalendarAction> = {
  SEND_EMAIL: "send_email",
  SAVE_DRAFT: "save_draft",
  RESCHEDULE_EVENT: "reschedule_event",
  DELETE_EVENT: "delete_event",
};

const statusToDb: Record<ApprovalStatus, IntegrationWriteStatus> = {
  pending: "PENDING",
  executing: "EXECUTING",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
};

const dbToStatus: Record<IntegrationWriteStatus, ApprovalStatus> = {
  PENDING: "pending",
  EXECUTING: "executing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
};

const providers = new Set<MailCalendarProvider>([
  "gmail",
  "outlook-mail",
  "google",
  "outlook",
]);

function isProvider(value: string): value is MailCalendarProvider {
  return providers.has(value as MailCalendarProvider);
}

type ApprovalRow = {
  id: string;
  ownerUserId: string;
  idempotencyKey: string;
  action: IntegrationWriteAction;
  provider: string;
  payloadHash: string;
  status: IntegrationWriteStatus;
  externalId: string | null;
  htmlLink: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorStatus: number | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: ApprovalRow): ApprovalRecord | null {
  const action = dbToAction[row.action];
  if (!action || !isProvider(row.provider)) return null;
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    idempotencyKey: row.idempotencyKey,
    action,
    provider: row.provider,
    payloadHash: row.payloadHash,
    status: dbToStatus[row.status],
    externalId: row.externalId,
    htmlLink: row.htmlLink,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    errorStatus: row.errorStatus,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

export function createPrismaApprovalStore(): ApprovalStore {
  return {
    async findByKey(ownerUserId, idempotencyKey) {
      const row = await prisma.integrationWriteApproval.findUnique({
        where: {
          ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey },
        },
      });
      return row ? toRecord(row) : null;
    },
    async findById(id) {
      const row = await prisma.integrationWriteApproval.findUnique({
        where: { id },
      });
      return row ? toRecord(row) : null;
    },
    async insert(record) {
      try {
        await prisma.integrationWriteApproval.create({
          data: {
            id: record.id,
            ownerUserId: record.ownerUserId,
            idempotencyKey: record.idempotencyKey,
            action: actionToDb[record.action],
            provider: record.provider,
            payloadHash: record.payloadHash,
            status: statusToDb[record.status],
            externalId: record.externalId,
            htmlLink: record.htmlLink,
            errorCode: record.errorCode,
            errorMessage: record.errorMessage,
            errorStatus: record.errorStatus,
            expiresAt: new Date(record.expiresAt),
            createdAt: new Date(record.createdAt),
          },
        });
        return "inserted";
      } catch (error) {
        if (isUniqueConflict(error)) return "conflict";
        throw error;
      }
    },
    async compareAndSet(id, from, to, patch) {
      const data: Prisma.IntegrationWriteApprovalUpdateManyMutationInput = {
        status: statusToDb[to],
      };
      if (patch.externalId !== undefined) data.externalId = patch.externalId;
      if (patch.htmlLink !== undefined) data.htmlLink = patch.htmlLink;
      if (patch.errorCode !== undefined) data.errorCode = patch.errorCode;
      if (patch.errorMessage !== undefined) data.errorMessage = patch.errorMessage;
      if (patch.errorStatus !== undefined) data.errorStatus = patch.errorStatus;
      if (patch.expiresAt !== undefined) data.expiresAt = new Date(patch.expiresAt);
      const result = await prisma.integrationWriteApproval.updateMany({
        where: { id, status: statusToDb[from] },
        data,
      });
      return result.count === 1;
    },
  };
}

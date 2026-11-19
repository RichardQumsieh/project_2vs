import { createHash, randomUUID } from "node:crypto";
import type { WriteGateFailure } from "./write-gate.js";
import { gateIntegrationWrite } from "./write-gate.js";
import { writeRequiredScopes } from "./write-scopes.js";
import {
  buildCalendarDeleteRequest,
  buildCalendarUpdateRequest,
  calendarDeleteAccepted,
  parseCalendarWriteResult,
  validateCalendarEventWritePayload,
  type CalendarEventWritePayload,
} from "./calendar-write.js";
import {
  buildEmailDraftCreateRequest,
  buildEmailSendRequest,
  parseEmailDraftWriteResult,
  parseEmailSendResult,
  validateEmailDraftWritePayload,
  type EmailDraftWritePayload,
} from "./email-write.js";
import { isMirrorId } from "./read-gate.js";
import type { CalendarProviderId } from "./calendar-providers.js";
import type { EmailProviderId } from "./email-providers.js";

export const approvalPendingTtlMs = 10 * 60_000;
export const approvalReplayTtlMs = 7 * 24 * 60 * 60_000;
export const approvalExecutingStaleMs = 2 * 60_000;

export type MailCalendarAction =
  | "send_email"
  | "save_draft"
  | "reschedule_event"
  | "delete_event";

export type MailCalendarProvider = "gmail" | "outlook-mail" | "google" | "outlook";

export type ApprovalStatus = "pending" | "executing" | "succeeded" | "failed";

export type ReschedulePayload = CalendarEventWritePayload & {
  externalEventId: string;
};

export type ValidatedProposal =
  | {
      action: "send_email" | "save_draft";
      provider: EmailProviderId;
      payload: EmailDraftWritePayload;
    }
  | {
      action: "reschedule_event";
      provider: CalendarProviderId;
      payload: ReschedulePayload;
    }
  | {
      action: "delete_event";
      provider: CalendarProviderId;
      payload: { eventId: string };
    };

export type ApprovalRecord = {
  id: string;
  ownerUserId: string;
  idempotencyKey: string;
  action: MailCalendarAction;
  provider: MailCalendarProvider;
  payloadHash: string;
  status: ApprovalStatus;
  externalId: string | null;
  htmlLink: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorStatus: number | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalStore = {
  findByKey(
    ownerUserId: string,
    idempotencyKey: string,
  ): Promise<ApprovalRecord | null>;
  findById(id: string): Promise<ApprovalRecord | null>;
  insert(record: ApprovalRecord): Promise<"inserted" | "conflict">;
  compareAndSet(
    id: string,
    from: ApprovalStatus,
    to: ApprovalStatus,
    patch: Partial<
      Pick<
        ApprovalRecord,
        | "externalId"
        | "htmlLink"
        | "errorCode"
        | "errorMessage"
        | "errorStatus"
        | "expiresAt"
      >
    >,
  ): Promise<boolean>;
};

export type ProviderHttp = {
  request(input: {
    url: string;
    method: "POST" | "PATCH" | "DELETE";
    accessToken: string;
    body?: unknown;
  }): Promise<{ status: number; json: unknown }>;
};

export type ApprovalConnection = {
  id: string;
  ownerUserId: string;
  status: string;
  scopes: string[];
  refreshTokenEncrypted: string;
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
};

export type ProviderCallResult =
  | {
      ok: true;
      externalId: string | null;
      htmlLink: string | null;
      connectionId: string | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code: string;
      consumed: boolean;
      missingScopes?: string[];
      connectionId?: string | null;
    };

export type ApprovalAudit = {
  record(input: {
    ownerUserId: string;
    actorUserId: string;
    actorLabel: string;
    action: MailCalendarAction;
    provider: MailCalendarProvider;
  }): Promise<void>;
};

type OkResponse = {
  ok: true;
  httpStatus: 200;
  id: string;
  status: ApprovalStatus;
  action: MailCalendarAction;
  provider: MailCalendarProvider;
  replayed: boolean;
  externalId: string | null;
  htmlLink: string | null;
  expiresAt: string;
};

type ErrResponse = {
  ok: false;
  httpStatus: number;
  error: string;
  code: string;
  replayed?: boolean;
  missingScopes?: string[];
  id?: string;
};

export type ApprovalResponse = OkResponse | ErrResponse;

const mailActions = new Set<MailCalendarAction>(["send_email", "save_draft"]);
const calendarActions = new Set<MailCalendarAction>([
  "reschedule_event",
  "delete_event",
]);

export function auditMetadata(action: MailCalendarAction) {
  switch (action) {
    case "send_email":
      return {
        activity: "EMAIL_SENT" as const,
        summary: "Approved email send",
        subjectKind: "email" as const,
      };
    case "save_draft":
      return {
        activity: "EMAIL_DRAFT_SAVED" as const,
        summary: "Approved email draft",
        subjectKind: "email" as const,
      };
    case "reschedule_event":
      return {
        activity: "CALENDAR_RESCHEDULE_APPROVED" as const,
        summary: "Approved calendar reschedule",
        subjectKind: "calendar" as const,
      };
    case "delete_event":
      return {
        activity: "CALENDAR_DELETE_APPROVED" as const,
        summary: "Approved calendar delete",
        subjectKind: "calendar" as const,
      };
  }
}

export function directWriteDecision(
  gate: { ok: true } | WriteGateFailure,
): {
  httpStatus: number;
  error: string;
  code: string;
  missingScopes?: string[];
} {
  if (!gate.ok) {
    return {
      httpStatus: gate.status,
      error: gate.error,
      code: gate.code ?? "write_rejected",
      missingScopes: gate.missingScopes,
    };
  }
  return {
    httpStatus: 409,
    error:
      "Explicit approval is required before this action can run. Nothing was sent.",
    code: "approval_required",
  };
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function hashApproval(value: {
  action: MailCalendarAction;
  provider: MailCalendarProvider;
  payload: unknown;
}) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function parseIdempotencyKey(value: unknown) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) return null;
  return key;
}

function isAction(value: string): value is MailCalendarAction {
  return mailActions.has(value as MailCalendarAction) || calendarActions.has(value as MailCalendarAction);
}

function isProvider(value: string): value is MailCalendarProvider {
  return (
    value === "gmail" ||
    value === "outlook-mail" ||
    value === "google" ||
    value === "outlook"
  );
}

function providerFits(action: MailCalendarAction, provider: MailCalendarProvider) {
  if (mailActions.has(action)) {
    return provider === "gmail" || provider === "outlook-mail";
  }
  return provider === "google" || provider === "outlook";
}

export function scopesForApproval(
  action: MailCalendarAction,
  provider: MailCalendarProvider,
): readonly string[] {
  if (provider === "gmail") {
    return action === "save_draft" ? ["gmail.compose"] : ["gmail.send"];
  }
  if (provider === "outlook-mail") {
    return action === "save_draft" ? ["Mail.ReadWrite"] : ["Mail.Send"];
  }
  if (provider === "google") return writeRequiredScopes.googleCalendar;
  return writeRequiredScopes.outlookCalendar;
}

function failure(
  httpStatus: number,
  error: string,
  code: string,
  extra?: Partial<ErrResponse>,
): ErrResponse {
  return { ok: false, httpStatus, error, code, ...extra };
}

function clip(value: string, max: number) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

export function validateProposalPayload(
  action: MailCalendarAction,
  provider: MailCalendarProvider,
  payload: unknown,
): { ok: true; proposal: ValidatedProposal } | { ok: false; error: string } {
  if (!providerFits(action, provider)) {
    return { ok: false, error: "That provider cannot run this action." };
  }
  if (action === "send_email" || action === "save_draft") {
    const parsed = validateEmailDraftWritePayload(payload);
    if (!parsed.ok) return parsed;
    if (provider !== "gmail" && provider !== "outlook-mail") {
      return { ok: false, error: "That provider cannot run this action." };
    }
    return {
      ok: true,
      proposal: { action, provider, payload: parsed.payload },
    };
  }
  if (action === "delete_event") {
    if (typeof payload !== "object" || payload === null) {
      return { ok: false, error: "Invalid payload" };
    }
    const eventId = (payload as { eventId?: unknown }).eventId;
    if (typeof eventId !== "string" || !isMirrorId(eventId)) {
      return { ok: false, error: "eventId must be an owned calendar mirror id" };
    }
    if (provider !== "google" && provider !== "outlook") {
      return { ok: false, error: "That provider cannot run this action." };
    }
    return { ok: true, proposal: { action, provider, payload: { eventId } } };
  }
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Invalid payload" };
  }
  const row = payload as Record<string, unknown>;
  const externalEventId = row.externalEventId;
  if (
    typeof externalEventId !== "string" ||
    !externalEventId.trim() ||
    externalEventId.length > 200 ||
    /[\u0000-\u001f]/.test(externalEventId)
  ) {
    return { ok: false, error: "externalEventId is required" };
  }
  const parsed = validateCalendarEventWritePayload(payload);
  if (!parsed.ok) return parsed;
  if (provider !== "google" && provider !== "outlook") {
    return { ok: false, error: "That provider cannot run this action." };
  }
  return {
    ok: true,
    proposal: {
      action: "reschedule_event",
      provider,
      payload: {
        ...parsed.payload,
        externalEventId: externalEventId.trim(),
      },
    },
  };
}

function present(record: ApprovalRecord, replayed: boolean): OkResponse {
  return {
    ok: true,
    httpStatus: 200,
    id: record.id,
    status: record.status,
    action: record.action,
    provider: record.provider,
    replayed,
    externalId: record.externalId,
    htmlLink: record.htmlLink,
    expiresAt: record.expiresAt,
  };
}

function replayFailure(record: ApprovalRecord): ErrResponse {
  return failure(
    record.errorStatus ?? 502,
    record.errorMessage ?? "The approved action failed. It was not run again.",
    record.errorCode ?? "approval_failed",
    { replayed: true, id: record.id },
  );
}

function expired(record: ApprovalRecord, pending: boolean): ErrResponse {
  return failure(
    410,
    pending
      ? "This approval expired before it ran. Nothing was sent."
      : "This approval result is no longer available. It was not run again.",
    pending ? "approval_expired" : "approval_result_expired",
    { id: record.id },
  );
}

export async function proposeMailCalendarWrite(input: {
  ownerUserId: string;
  body: unknown;
  store: ApprovalStore;
  now?: Date;
  createId?: () => string;
}): Promise<ApprovalResponse> {
  if (typeof input.body !== "object" || input.body === null) {
    return failure(400, "Invalid payload", "invalid_payload");
  }
  const body = input.body as Record<string, unknown>;
  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  if (!idempotencyKey) {
    return failure(
      400,
      "idempotencyKey must be 8–80 letters, numbers, hyphens, or underscores.",
      "invalid_idempotency_key",
    );
  }
  if (typeof body.action !== "string" || !isAction(body.action)) {
    return failure(400, "Unknown mail or calendar action", "invalid_action");
  }
  if (typeof body.provider !== "string" || !isProvider(body.provider)) {
    return failure(400, "Unknown mail or calendar provider", "invalid_provider");
  }
  const validated = validateProposalPayload(body.action, body.provider, body.payload);
  if (!validated.ok) {
    return failure(400, validated.error, "invalid_payload");
  }
  const now = input.now ?? new Date();
  const payloadHash = hashApproval(validated.proposal);
  const existing = await input.store.findByKey(input.ownerUserId, idempotencyKey);
  if (existing) {
    if (
      existing.payloadHash !== payloadHash ||
      existing.action !== validated.proposal.action ||
      existing.provider !== validated.proposal.provider
    ) {
      return failure(
        409,
        "This approval id was already used for a different action. Nothing was sent.",
        "idempotency_key_reused",
        { id: existing.id },
      );
    }
    return present(existing, existing.status !== "pending");
  }
  const timestamp = now.toISOString();
  const record: ApprovalRecord = {
    id: (input.createId ?? randomUUID)(),
    ownerUserId: input.ownerUserId,
    idempotencyKey,
    action: validated.proposal.action,
    provider: validated.proposal.provider,
    payloadHash,
    status: "pending",
    externalId: null,
    htmlLink: null,
    errorCode: null,
    errorMessage: null,
    errorStatus: null,
    expiresAt: new Date(now.getTime() + approvalPendingTtlMs).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const inserted = await input.store.insert(record);
  if (inserted === "conflict") {
    const winner = await input.store.findByKey(input.ownerUserId, idempotencyKey);
    if (
      !winner ||
      winner.payloadHash !== payloadHash ||
      winner.action !== record.action ||
      winner.provider !== record.provider
    ) {
      return failure(
        409,
        "This approval id was already used for a different action. Nothing was sent.",
        "idempotency_key_reused",
        { id: winner?.id },
      );
    }
    return present(winner, winner.status !== "pending");
  }
  return present(record, false);
}

function busy(record: ApprovalRecord, now: Date): ErrResponse {
  const age = now.getTime() - Date.parse(record.updatedAt);
  if (Number.isFinite(age) && age >= approvalExecutingStaleMs) {
    return failure(
      409,
      "This approval did not finish confirming. It will not run again automatically. Check the mailbox or calendar before proposing a new one.",
      "approval_unconfirmed",
      { id: record.id },
    );
  }
  return failure(
    409,
    "This approval is already running. Nothing else will be sent for it.",
    "approval_in_progress",
    { id: record.id },
  );
}

function interpretExisting(
  record: ApprovalRecord,
  now: Date,
  payloadHash: string,
): ApprovalResponse | null {
  if (record.payloadHash !== payloadHash) {
    return failure(
      409,
      "The approved content does not match the original proposal. Nothing was sent.",
      "payload_mismatch",
      { id: record.id },
    );
  }
  const expires = Date.parse(record.expiresAt);
  if (record.status === "pending") {
    if (!Number.isFinite(expires) || expires <= now.getTime()) {
      return expired(record, true);
    }
    return null;
  }
  if (!Number.isFinite(expires) || expires <= now.getTime()) {
    return expired(record, false);
  }
  if (record.status === "succeeded") return present(record, true);
  if (record.status === "failed") return replayFailure(record);
  return busy(record, now);
}

export async function approveMailCalendarWrite(input: {
  ownerUserId: string;
  actorUserId: string;
  actorLabel: string;
  approvalId: string;
  payload: unknown;
  store: ApprovalStore;
  perform: (proposal: ValidatedProposal) => Promise<ProviderCallResult>;
  audit: ApprovalAudit;
  now?: Date;
}): Promise<ApprovalResponse> {
  if (input.actorUserId !== input.ownerUserId) {
    return failure(404, "Not found", "not_found");
  }
  const record = await input.store.findById(input.approvalId);
  if (!record || record.ownerUserId !== input.ownerUserId) {
    return failure(404, "Not found", "not_found");
  }
  const validated = validateProposalPayload(
    record.action,
    record.provider,
    input.payload,
  );
  if (!validated.ok) {
    return failure(400, validated.error, "invalid_payload", { id: record.id });
  }
  const payloadHash = hashApproval(validated.proposal);
  const now = input.now ?? new Date();
  const existing = interpretExisting(record, now, payloadHash);
  if (existing) return existing;

  const claimed = await input.store.compareAndSet(
    record.id,
    "pending",
    "executing",
    {},
  );
  if (!claimed) {
    const latest = await input.store.findById(record.id);
    if (!latest || latest.ownerUserId !== input.ownerUserId) {
      return failure(404, "Not found", "not_found");
    }
    const again = interpretExisting(latest, now, payloadHash);
    if (again) return again;
    return busy(latest, now);
  }

  let outcome: ProviderCallResult;
  try {
    outcome = await input.perform(validated.proposal);
  } catch {
    outcome = {
      ok: false,
      status: 502,
      error:
        "The provider did not confirm the action. Check the mailbox or calendar before proposing again. This approval will not run twice.",
      code: "provider_uncertain",
      consumed: true,
    };
  }

  const replayUntil = new Date(now.getTime() + approvalReplayTtlMs).toISOString();
  if (outcome.ok) {
    const marked = await input.store.compareAndSet(record.id, "executing", "succeeded", {
      externalId: outcome.externalId,
      htmlLink: outcome.htmlLink,
      errorCode: null,
      errorMessage: null,
      errorStatus: null,
      expiresAt: replayUntil,
    });
    if (marked) {
      try {
        await input.audit.record({
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          actorLabel: input.actorLabel,
          action: record.action,
          provider: record.provider,
        });
      } catch {
        // The provider call already succeeded. A missing audit row must not retry it.
      }
    }
    return {
      ok: true,
      httpStatus: 200,
      id: record.id,
      status: "succeeded",
      action: record.action,
      provider: record.provider,
      replayed: false,
      externalId: outcome.externalId,
      htmlLink: outcome.htmlLink,
      expiresAt: replayUntil,
    };
  }

  if (!outcome.consumed) {
    await input.store.compareAndSet(record.id, "executing", "pending", {
      errorCode: null,
      errorMessage: null,
      errorStatus: null,
    });
    return failure(outcome.status, outcome.error, outcome.code, {
      id: record.id,
      missingScopes: outcome.missingScopes,
    });
  }

  const errorMessage = clip(outcome.error, 200);
  await input.store.compareAndSet(record.id, "executing", "failed", {
    externalId: null,
    htmlLink: null,
    errorCode: outcome.code.slice(0, 80),
    errorMessage,
    errorStatus: outcome.status,
    expiresAt: replayUntil,
  });
  return failure(outcome.status, errorMessage, outcome.code, {
    id: record.id,
    missingScopes: outcome.missingScopes,
    replayed: false,
  });
}

function providerFailure(
  action: MailCalendarAction,
  status: number,
  incomplete = false,
): ProviderCallResult {
  const label = {
    send_email: "Email send",
    save_draft: "Email draft save",
    reschedule_event: "Calendar reschedule",
    delete_event: "Calendar delete",
  }[action];
  const prefix = {
    send_email: "email_send",
    save_draft: "email_draft",
    reschedule_event: "calendar_reschedule",
    delete_event: "calendar_delete",
  }[action];
  const code = incomplete ? `${prefix}_incomplete` : `${prefix}_${status}`;
  const error = incomplete
    ? `${label} did not return a usable result. This approval will not run again. Check the mailbox or calendar before proposing a new one.`
    : `${label} failed (${code}). This approval will not run again.`;
  return { ok: false, status: 502, error, code, consumed: true };
}

function uncertain(): ProviderCallResult {
  return {
    ok: false,
    status: 502,
    error:
      "The provider did not confirm the action. Check the mailbox or calendar before proposing again. This approval will not run twice.",
    code: "provider_uncertain",
    consumed: true,
  };
}

export async function dispatchApprovedWrite(input: {
  proposal: ValidatedProposal;
  accessToken: string;
  deleteTarget?: { calendarId: string; externalEventId: string } | null;
  http: ProviderHttp;
}): Promise<ProviderCallResult> {
  try {
    if (input.proposal.action === "delete_event") {
      if (!input.deleteTarget) {
        return {
          ok: false,
          status: 404,
          error: "Not found",
          code: "not_found",
          consumed: true,
        };
      }
      const request = buildCalendarDeleteRequest(
        input.proposal.provider,
        input.deleteTarget.calendarId,
        input.deleteTarget.externalEventId,
      );
      const result = await input.http.request({
        url: request.url,
        method: "DELETE",
        accessToken: input.accessToken,
      });
      if (!calendarDeleteAccepted(result.status)) {
        return providerFailure(input.proposal.action, result.status);
      }
      return {
        ok: true,
        externalId: input.deleteTarget.externalEventId,
        htmlLink: null,
        connectionId: null,
      };
    }

    if (input.proposal.action === "send_email" || input.proposal.action === "save_draft") {
      const request =
        input.proposal.action === "send_email"
          ? buildEmailSendRequest(input.proposal.provider, input.proposal.payload)
          : buildEmailDraftCreateRequest(input.proposal.provider, input.proposal.payload);
      const result = await input.http.request({
        url: request.url,
        method: request.method,
        accessToken: input.accessToken,
        body: request.body,
      });
      if (result.status < 200 || result.status >= 300) {
        return providerFailure(input.proposal.action, result.status);
      }
      if (input.proposal.action === "send_email") {
        const parsed = parseEmailSendResult(
          input.proposal.provider,
          result.json,
          result.status,
        );
        if (!parsed) return providerFailure(input.proposal.action, result.status, true);
        return {
          ok: true,
          externalId: parsed.externalMessageId,
          htmlLink: null,
          connectionId: null,
        };
      }
      const parsed = parseEmailDraftWriteResult(input.proposal.provider, result.json);
      if (!parsed) return providerFailure(input.proposal.action, result.status, true);
      return {
        ok: true,
        externalId: parsed.externalDraftId,
        htmlLink: null,
        connectionId: null,
      };
    }

    if (input.proposal.action !== "reschedule_event") {
      return uncertain();
    }
    const provider = input.proposal.provider;
    const payload = input.proposal.payload;
    const request = buildCalendarUpdateRequest(
      provider,
      payload.externalEventId,
      payload,
    );
    const result = await input.http.request({
      url: request.url,
      method: request.method,
      accessToken: input.accessToken,
      body: request.body,
    });
    if (result.status < 200 || result.status >= 300) {
      return providerFailure("reschedule_event", result.status);
    }
    const parsed = parseCalendarWriteResult(provider, result.json);
    if (!parsed) return providerFailure("reschedule_event", result.status, true);
    return {
      ok: true,
      externalId: parsed.externalEventId,
      htmlLink: parsed.htmlLink,
      connectionId: null,
    };
  } catch {
    return uncertain();
  }
}

export async function performMailCalendarApproval(input: {
  proposal: ValidatedProposal;
  sessionUserId: string;
  username: string;
  userEmail: string | null;
  writesEnabled: boolean;
  allowlist: readonly string[];
  oauthConfigured: boolean;
  loadConnection: () => Promise<ApprovalConnection | null>;
  loadDeleteTarget: () => Promise<{
    connection: ApprovalConnection;
    calendarId: string;
    externalEventId: string;
  } | null>;
  resolveAccessToken: (connection: ApprovalConnection) => Promise<string>;
  http: ProviderHttp;
  afterSuccess?: (info: {
    connectionId: string;
    externalId: string | null;
  }) => Promise<void>;
}): Promise<ProviderCallResult> {
  const audienceGate = gateIntegrationWrite({
    ownerUserId: input.sessionUserId,
    sessionUserId: input.sessionUserId,
    status: "CONNECTED",
    grantedScopes: [],
    requiredWriteScopes: [],
    writesEnabled: input.writesEnabled,
    allowlist: input.allowlist,
    username: input.username,
    userEmail: input.userEmail,
  });
  if (!audienceGate.ok) {
    return {
      ok: false,
      status: audienceGate.status,
      error: audienceGate.error,
      code: audienceGate.code ?? "write_rejected",
      consumed: false,
    };
  }

  let connection: ApprovalConnection | null = null;
  let deleteTarget: { calendarId: string; externalEventId: string } | null = null;
  let accessToken = "";
  try {
    if (input.proposal.action === "delete_event") {
      const target = await input.loadDeleteTarget();
      if (!target) {
        return {
          ok: false,
          status: 404,
          error: "Not found",
          code: "not_found",
          consumed: true,
        };
      }
      connection = target.connection;
      deleteTarget = {
        calendarId: target.calendarId,
        externalEventId: target.externalEventId,
      };
    } else {
      connection = await input.loadConnection();
    }

    if (!connection) {
      return {
        ok: false,
        status: 409,
        error: "Integration is not connected. Nothing was sent.",
        code: "not_connected",
        consumed: false,
      };
    }

    const gate = gateIntegrationWrite({
      ownerUserId: connection.ownerUserId,
      sessionUserId: input.sessionUserId,
      status: connection.status,
      grantedScopes: connection.scopes,
      requiredWriteScopes: scopesForApproval(
        input.proposal.action,
        input.proposal.provider,
      ),
      writesEnabled: input.writesEnabled,
      allowlist: input.allowlist,
      username: input.username,
      userEmail: input.userEmail,
    });
    if (!gate.ok) {
      return {
        ok: false,
        status: gate.status,
        error: gate.error,
        code: gate.code ?? "write_rejected",
        missingScopes: gate.missingScopes,
        consumed: false,
        connectionId: connection.id,
      };
    }
    if (!input.oauthConfigured) {
      const family = mailActions.has(input.proposal.action) ? "Email" : "Calendar";
      return {
        ok: false,
        status: 503,
        error: `${family} OAuth is not configured. Nothing was sent.`,
        code: "oauth_not_configured",
        consumed: false,
        connectionId: connection.id,
      };
    }

    try {
      accessToken = await input.resolveAccessToken(connection);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const code = /^token_refresh_[a-z0-9_]+$/.test(raw)
        ? raw.slice(0, 64)
        : "token_refresh_failed";
      return {
        ok: false,
        status: 502,
        error: "Could not refresh the provider token. Nothing was sent.",
        code,
        consumed: false,
        connectionId: connection.id,
      };
    }
  } catch {
    return {
      ok: false,
      status: 503,
      error: "The approval could not be started. Nothing was sent.",
      code: "approval_not_started",
      consumed: false,
    };
  }

  if (!connection || !accessToken) {
    return {
      ok: false,
      status: 503,
      error: "The approval could not be started. Nothing was sent.",
      code: "approval_not_started",
      consumed: false,
    };
  }

  const dispatched = await dispatchApprovedWrite({
    proposal: input.proposal,
    accessToken,
    deleteTarget,
    http: input.http,
  });
  if (!dispatched.ok) {
    return { ...dispatched, connectionId: connection.id };
  }
  if (input.afterSuccess) {
    try {
      await input.afterSuccess({
        connectionId: connection.id,
        externalId: dispatched.externalId,
      });
    } catch {
      // The provider already accepted the write. Mirror cleanup must not retry it.
    }
  }
  return { ...dispatched, connectionId: connection.id };
}

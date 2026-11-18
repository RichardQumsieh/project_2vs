import { denyUnlessOwner } from "../task-authorization.js";
import { missingScopes } from "./write-scopes.js";

export type ReadGateFailure = {
  ok: false;
  status: 403 | 404 | 409;
  error: string;
  code?: string;
  missingScopes?: string[];
};

export type ReadGateSuccess = { ok: true };

/**
 * Owner-scoped read of mail or calendar detail.
 * Opening an item uses the stored token and returns the body to that owner.
 * It does not consult INTEGRATIONS_WRITE_ENABLED and it does not persist the body.
 */
export function gateIntegrationRead(input: {
  ownerUserId: string | null | undefined;
  sessionUserId: string;
  status: string | null | undefined;
  grantedScopes: string[];
  requiredReadScopes: readonly string[];
}): ReadGateSuccess | ReadGateFailure {
  const ownership = denyUnlessOwner({
    ownerUserId: input.ownerUserId,
    sessionUserId: input.sessionUserId,
  });
  if (!ownership.ok) {
    return {
      ok: false,
      status: ownership.status,
      error: ownership.error,
      code: "not_found",
    };
  }

  if (input.status !== "CONNECTED") {
    return {
      ok: false,
      status: 409,
      error: "Integration is not connected",
      code: "not_connected",
    };
  }

  const missing = missingScopes(input.grantedScopes, [
    ...input.requiredReadScopes,
  ]);
  if (missing.length > 0) {
    return {
      ok: false,
      status: 403,
      error: "Reconnect this integration to grant read access",
      code: "scope_upgrade_required",
      missingScopes: missing,
    };
  }

  return { ok: true };
}

/** Scopes already requested at connect time. Reading does not add any. */
export const readRequiredScopes = {
  gmail: ["gmail.readonly"],
  outlookMail: ["Mail.ReadWrite"],
  googleCalendar: ["calendar.events"],
  outlookCalendar: ["Calendars.ReadWrite"],
} as const;

const mirrorIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMirrorId(value: string) {
  return mirrorIdPattern.test(value);
}

/**
 * Log line for a live read. Callers must pass ids and status only.
 * The message or event body is intentionally not a field.
 */
export function integrationReadLog(fields: {
  family: "email" | "calendar";
  provider: string;
  connectionId: string;
  resourceId: string;
  status: number;
}) {
  return {
    integrationRead: true as const,
    family: fields.family,
    provider: fields.provider,
    connectionId: fields.connectionId,
    resourceId: fields.resourceId,
    status: fields.status,
  };
}

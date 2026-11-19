import { denyUnlessOwner } from "../task-authorization.js";
import {
  connectionNeedsScopeUpgrade,
  missingScopes,
} from "./write-scopes.js";

export type WriteGateFailure = {
  ok: false;
  status: 403 | 404 | 409 | 503;
  error: string;
  code?: string;
  missingScopes?: string[];
};

export type WriteGateSuccess = {
  ok: true;
};

/** Comma-separated user ids, usernames, or emails. Matching is case-insensitive. */
export function userMatchesWriteAllowlist(input: {
  allowlist: readonly string[];
  userId: string;
  username?: string | null;
  email?: string | null;
}) {
  if (input.allowlist.length === 0) return true;
  const allowed = new Set(
    input.allowlist.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );
  const candidates = [input.userId, input.username, input.email];
  return candidates.some(
    (value) => typeof value === "string" && allowed.has(value.trim().toLowerCase()),
  );
}

/**
 * Shared authz for owner-scoped write APIs.
 * - Feature flag off → 503 writes_disabled (allowlist does not bypass the flag)
 * - Allowlist set and this account is absent → 503 writes_not_enabled_for_user
 * - Wrong/missing owner → 404 (no IDOR leak)
 * - Not connected → 409
 * - Missing write scopes → 403 scope_upgrade_required
 */
export function gateIntegrationWrite(input: {
  ownerUserId: string | null | undefined;
  sessionUserId: string;
  status: string | null | undefined;
  grantedScopes: string[];
  requiredWriteScopes: readonly string[];
  writesEnabled: boolean;
  allowlist?: readonly string[];
  username?: string | null;
  userEmail?: string | null;
}): WriteGateSuccess | WriteGateFailure {
  if (!input.writesEnabled) {
    return {
      ok: false,
      status: 503,
      error: "Integration writes are disabled on this server",
      code: "writes_disabled",
    };
  }

  const allowlist = input.allowlist ?? [];
  if (
    allowlist.length > 0 &&
    !userMatchesWriteAllowlist({
      allowlist,
      userId: input.sessionUserId,
      username: input.username,
      email: input.userEmail,
    })
  ) {
    return {
      ok: false,
      status: 503,
      error: "Integration writes are not enabled for this account",
      code: "writes_not_enabled_for_user",
    };
  }

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
    ...input.requiredWriteScopes,
  ]);
  if (missing.length > 0) {
    return {
      ok: false,
      status: 403,
      error:
        "Reconnect this integration to upgrade OAuth permissions for writes",
      code: "scope_upgrade_required",
      missingScopes: missing,
    };
  }

  return { ok: true };
}

export function writeUpgradeHint(input: {
  grantedScopes: string[];
  requiredWriteScopes: readonly string[];
  writesEnabled: boolean;
}) {
  const needsUpgrade = connectionNeedsScopeUpgrade(
    input.grantedScopes,
    input.requiredWriteScopes,
  );
  return {
    writesEnabled: input.writesEnabled,
    needsScopeUpgrade: needsUpgrade,
    requiredWriteScopes: [...input.requiredWriteScopes],
  };
}

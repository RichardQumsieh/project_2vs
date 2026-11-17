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

/**
 * Shared authz for owner-scoped write APIs.
 * - Feature flag off → 503 writes_disabled
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
}): WriteGateSuccess | WriteGateFailure {
  if (!input.writesEnabled) {
    return {
      ok: false,
      status: 503,
      error: "Integration writes are disabled on this server",
      code: "writes_disabled",
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

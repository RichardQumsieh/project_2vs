/**
 * Phase 4.2 write-scope helpers.
 * Compare granted OAuth scopes on a connection against the scopes the
 * product now requests. Used for Settings "upgrade / reconnect" UX and
 * missing-scope errors on write APIs.
 */

function normalizeScopeToken(scope: string) {
  const trimmed = scope.trim();
  if (!trimmed) {
    return "";
  }
  // Google returns full URLs; Microsoft/Slack/Linear often return short names.
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    return parts[parts.length - 1]!.toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function normalizeGrantedScopes(scopes: string[]) {
  return new Set(
    scopes.map(normalizeScopeToken).filter((scope) => scope.length > 0),
  );
}

export function missingScopes(granted: string[], required: string[]) {
  const have = normalizeGrantedScopes(granted);
  return required.filter((scope) => !have.has(normalizeScopeToken(scope)));
}

export function hasAllScopes(granted: string[], required: string[]) {
  return missingScopes(granted, required).length === 0;
}

/** Scopes that must be present for write APIs (subset of provider authorize list). */
export const writeRequiredScopes = {
  googleCalendar: ["calendar.events"],
  outlookCalendar: ["Calendars.ReadWrite"],
  gmail: ["gmail.compose", "gmail.send"],
  outlookMail: ["Mail.ReadWrite", "Mail.Send"],
  github: ["repo"],
  linear: ["write"],
  slack: ["chat:write"],
} as const;

export function connectionNeedsScopeUpgrade(
  granted: string[],
  required: readonly string[],
) {
  return missingScopes(granted, [...required]).length > 0;
}

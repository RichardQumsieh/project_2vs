export function isOwnedByUser(ownerUserId: string, sessionUserId: string) {
  return ownerUserId === sessionUserId;
}

export function denyUnlessOwner(input: {
  ownerUserId: string | null | undefined;
  sessionUserId: string;
}) {
  if (!input.ownerUserId || !isOwnedByUser(input.ownerUserId, input.sessionUserId)) {
    return { ok: false as const, status: 404 as const, error: "Not found" };
  }
  return { ok: true as const };
}

/** In-process sliding window. Routes also set a Fastify IP limit. */

export const inviteCreateLimit = { max: 8, windowMs: 60 * 60 * 1000 };
export const inviteRedeemLimit = { max: 10, windowMs: 15 * 60 * 1000 };
export const invitePreviewLimit = { max: 30, windowMs: 15 * 60 * 1000 };

export function consumeBucket(
  timestamps: readonly number[] | undefined,
  now: number,
  limit: number,
  windowMs: number,
): { ok: boolean; timestamps: number[] } {
  const recent = (timestamps ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) return { ok: false, timestamps: recent };
  recent.push(now);
  return { ok: true, timestamps: recent };
}

const buckets = new Map<string, number[]>();

export function takeInviteSlot(key: string, now: number, limit: number, windowMs: number): boolean {
  const decision = consumeBucket(buckets.get(key), now, limit, windowMs);
  buckets.set(key, decision.timestamps);
  return decision.ok;
}

export function resetInviteSlots(): void {
  buckets.clear();
}

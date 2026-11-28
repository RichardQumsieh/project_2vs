export type RateBucket = { start: number; count: number };

export type RateDecision = {
  ok: boolean;
  retryAfterMs: number;
  remaining: number;
};

/**
 * Fixed-window counter. `buckets` is owned by the caller so tests can inject it
 * and production can keep one process-local map.
 */
export function consumeRateLimit(
  buckets: Map<string, RateBucket>,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): RateDecision {
  const existing = buckets.get(key);
  if (!existing || now - existing.start >= windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return { ok: true, retryAfterMs: 0, remaining: limit - 1 };
  }
  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfterMs: Math.max(0, windowMs - (now - existing.start)),
      remaining: 0,
    };
  }
  existing.count += 1;
  return { ok: true, retryAfterMs: 0, remaining: limit - existing.count };
}

export function pruneRateLimits(buckets: Map<string, RateBucket>, windowMs: number, now: number, maxSize = 5_000) {
  if (buckets.size <= maxSize) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.start >= windowMs) buckets.delete(key);
  }
}

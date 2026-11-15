import type { Clock } from "./ports";

export interface RateLimitPolicy {
  /** Calls allowed per key inside one window. */
  readonly limit: number;
  readonly windowMs: number;
}

export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface RateLimiter {
  take(key: string): RateLimitDecision;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed window counter per key, held in memory. Expired windows are dropped as new keys arrive. */
export function makeRateLimiter(deps: { clock: Clock; policy: RateLimitPolicy }): RateLimiter {
  const { clock, policy } = deps;
  const buckets = new Map<string, Bucket>();

  function sweep(now: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    take(key) {
      const now = clock.now().getTime();
      const current = buckets.get(key);
      if (current === undefined || current.resetAt <= now) {
        sweep(now);
        buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
        return { allowed: true };
      }
      if (current.count >= policy.limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        };
      }
      current.count += 1;
      return { allowed: true };
    },
  };
}

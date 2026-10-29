import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { getRedis } from './redis';

/**
 * Fixed-window rate limiting shared by the web app, Better Auth and the
 * worker. Redis is the shared store so two web tasks enforce one bucket; a
 * Redis outage falls back to an in-process store rather than failing every
 * write open.
 */
export type RateLimitRule = {
  /** Window length in seconds. */
  window: number;
  /** Maximum hits allowed in the window. */
  max: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends. Always at least 1. */
  retryAfterSeconds: number;
  /** Epoch milliseconds when the current window resets. */
  resetAt: number;
};

export type RateLimitHit = {
  count: number;
  ttlMs: number;
};

export interface RateLimitStore {
  hit(key: string, rule: RateLimitRule): Promise<RateLimitHit>;
}

const NAMESPACE = 'owm:rl';

/** Avoid storing an email address or IP verbatim as a Redis key. */
export function rateLimitKey(scope: string, identifier: string) {
  const digest = createHash('sha256').update(identifier).digest('hex').slice(0, 40);
  return `${scope}:${digest}`;
}

/**
 * Increment a counter and set its TTL atomically. A plain INCR followed by
 * PEXPIRE can leave an immortal key if the process dies between the two calls.
 */
const INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export function createRedisRateLimitStore(redis: Pick<Redis, 'eval'>): RateLimitStore {
  return {
    async hit(key, rule) {
      const result = (await redis.eval(
        INCR_SCRIPT,
        1,
        `${NAMESPACE}:${key}`,
        String(Math.max(1, Math.round(rule.window * 1000))),
      )) as [number | string, number | string];
      return {
        count: Number(result[0]),
        ttlMs: Math.max(1, Number(result[1])),
      };
    },
  };
}

export function createMemoryRateLimitStore(
  now: () => number = () => Date.now(),
): RateLimitStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, rule) {
      const current = now();
      const existing = buckets.get(key);
      if (!existing || current >= existing.resetAt) {
        const resetAt = current + Math.max(1, rule.window * 1000);
        buckets.set(key, { count: 1, resetAt });
        // Opportunistically trim expired buckets so the map cannot grow with
        // every address that ever hit the app.
        if (buckets.size > 10_000) {
          for (const [candidate, bucket] of buckets) {
            if (current >= bucket.resetAt) buckets.delete(candidate);
          }
        }
        return { count: 1, ttlMs: resetAt - current };
      }

      existing.count += 1;
      return { count: existing.count, ttlMs: Math.max(1, existing.resetAt - current) };
    },
  };
}

const globalForRateLimit = globalThis as unknown as {
  __owmRateLimitStore?: RateLimitStore;
  __owmRateLimitMemory?: RateLimitStore;
};

/**
 * The default store: Redis when it answers, an in-process store when it does
 * not. Abuse controls should degrade, not turn every write into a 500.
 */
export function getRateLimitStore(): RateLimitStore {
  if (!globalForRateLimit.__owmRateLimitStore) {
    globalForRateLimit.__owmRateLimitMemory ??= createMemoryRateLimitStore();
    const fallback = globalForRateLimit.__owmRateLimitMemory;
    let warned = false;
    globalForRateLimit.__owmRateLimitStore = {
      async hit(key, rule) {
        try {
          return await createRedisRateLimitStore(getRedis()).hit(key, rule);
        } catch (error) {
          if (!warned) {
            warned = true;
            console.error('[rate-limit] Redis unavailable; using the in-process store', error);
          }
          return fallback.hit(key, rule);
        }
      },
    };
  }
  return globalForRateLimit.__owmRateLimitStore;
}

export function resetRateLimitStoreForTests() {
  globalForRateLimit.__owmRateLimitStore = undefined;
  globalForRateLimit.__owmRateLimitMemory = undefined;
}

export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  store: RateLimitStore = getRateLimitStore(),
): Promise<RateLimitDecision> {
  const resolved: RateLimitRule = {
    window: Math.max(1, Math.ceil(rule.window)),
    max: Math.max(1, Math.floor(rule.max)),
  };
  const { count, ttlMs } = await store.hit(key, resolved);

  return {
    allowed: count <= resolved.max,
    limit: resolved.max,
    remaining: Math.max(0, resolved.max - count),
    retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
    resetAt: Date.now() + ttlMs,
  };
}

/**
 * Better Auth accepts a `customStorage` shape. Wrapping the same store keeps
 * magic-link buckets shared across web tasks instead of per-process memory.
 */
export function createBetterAuthRateLimitStorage(
  store: RateLimitStore = getRateLimitStore(),
): { consume: (key: string, rule: RateLimitRule) => Promise<{ allowed: boolean; retryAfter: number | null }> } {
  return {
    async consume(key, rule) {
      const result = await consumeRateLimit(`auth:${key}`, rule, store);
      return {
        allowed: result.allowed,
        retryAfter: result.allowed ? null : result.retryAfterSeconds,
      };
    },
  };
}

/** Read a positive integer from the environment, falling back on bad input. */
export function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

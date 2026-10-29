import { describe, expect, it } from 'vitest';
import {
  consumeRateLimit,
  createBetterAuthRateLimitStorage,
  createMemoryRateLimitStore,
  intFromEnv,
  rateLimitKey,
} from '../src/rate-limit';

function clock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('rate limiting', () => {
  it('allows up to the limit, then reports when to retry', async () => {
    const time = clock();
    const store = createMemoryRateLimitStore(time.now);
    const rule = { window: 60, max: 2 };

    const first = await consumeRateLimit('write:user-a', rule, store);
    const second = await consumeRateLimit('write:user-a', rule, store);
    const blocked = await consumeRateLimit('write:user-a', rule, store);

    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('starts a fresh window after it expires', async () => {
    const time = clock();
    const store = createMemoryRateLimitStore(time.now);
    const rule = { window: 30, max: 1 };

    expect((await consumeRateLimit('write:user-a', rule, store)).allowed).toBe(true);
    expect((await consumeRateLimit('write:user-a', rule, store)).allowed).toBe(false);

    time.advance(30_000);
    expect((await consumeRateLimit('write:user-a', rule, store)).allowed).toBe(true);
  });

  it('keeps separate buckets per key', async () => {
    const store = createMemoryRateLimitStore();
    const rule = { window: 60, max: 1 };

    expect((await consumeRateLimit('write:user-a', rule, store)).allowed).toBe(true);
    expect((await consumeRateLimit('write:user-b', rule, store)).allowed).toBe(true);
  });

  it('hashes identifiers so emails and IPs are not Redis keys', () => {
    const key = rateLimitKey('magic-link:email', 'Person@Example.com');
    expect(key).toMatch(/^magic-link:email:[a-f0-9]{40}$/);
    expect(key).not.toContain('Person@Example.com');
    expect(key).not.toEqual(rateLimitKey('magic-link:email', 'other@example.com'));
  });

  it('adapts to Better Auth custom storage', async () => {
    const store = createMemoryRateLimitStore();
    const storage = createBetterAuthRateLimitStorage(store);
    const rule = { window: 60, max: 1 };

    expect(await storage.consume('1.2.3.4:/sign-in/magic-link', rule)).toEqual({
      allowed: true,
      retryAfter: null,
    });
    const blocked = await storage.consume('1.2.3.4:/sign-in/magic-link', rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('clamps bad and non-positive limits', async () => {
    const store = createMemoryRateLimitStore();
    const result = await consumeRateLimit('key', { window: 0, max: 0 }, store);
    expect(result.limit).toBe(1);
    expect(result.allowed).toBe(true);
  });
});

describe('intFromEnv', () => {
  it('accepts positive integers and falls back otherwise', () => {
    expect(intFromEnv('12', 5)).toBe(12);
    expect(intFromEnv('1.9', 5)).toBe(1);
    expect(intFromEnv('nope', 5)).toBe(5);
    expect(intFromEnv('0', 5)).toBe(5);
    expect(intFromEnv(undefined, 5)).toBe(5);
  });
});

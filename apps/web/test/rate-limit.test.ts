import { describe, expect, it } from 'vitest';
import { DomainError, tooMany } from '@owm/core';
import { apiError } from '../src/lib/api';
import { clientIp } from '../src/lib/rate-limit';

describe('clientIp', () => {
  it('uses the right-most forwarded address (the one the ALB appended)', () => {
    const headers = new Headers({
      // The left-most entry is client-supplied and can be rotated to evade a
      // per-IP bucket; the ALB appends the peer it actually saw.
      'x-forwarded-for': '203.0.113.9, 10.0.0.2, 10.0.0.3',
      'x-real-ip': '198.51.100.4',
    });
    expect(clientIp(headers)).toBe('10.0.0.3');
  });

  it('falls back to direct headers and finally a shared bucket', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('apiError retry guidance', () => {
  it('returns 429 with Retry-After and the wait in the body', async () => {
    const response = apiError(tooMany('Too many writes.', 42));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'rate_limited',
        message: 'Too many writes. Try again in 42 seconds.',
        retryAfter: 42,
      },
    });
  });

  it('surfaces the spend-cap code with the month reset as retry guidance', async () => {
    const response = apiError(
      new DomainError('spend_cap_reached', 'The cap has been reached.', 429, {
        retryAfterSeconds: 3600,
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3600');
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'spend_cap_reached', retryAfter: 3600 },
    });
  });

  it('does not add a Retry-After header to a normal domain error', () => {
    const response = apiError(new DomainError('not_found', 'Nope', 404));
    expect(response.headers.get('retry-after')).toBeNull();
  });
});

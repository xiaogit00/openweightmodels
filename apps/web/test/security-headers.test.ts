import { afterEach, describe, expect, it } from 'vitest';
import config from '../next.config';
import robots from '../src/app/robots';

const original = process.env.ALLOW_SEARCH_INDEXING;

afterEach(() => {
  if (original === undefined) delete process.env.ALLOW_SEARCH_INDEXING;
  else process.env.ALLOW_SEARCH_INDEXING = original;
});

async function headers(): Promise<Map<string, string>> {
  const groups = await config.headers!();
  expect(groups).toHaveLength(1);
  expect(groups[0]!.source).toBe('/:path*');
  return new Map(groups[0]!.headers.map((header) => [header.key, header.value]));
}

describe('response hardening', () => {
  it('does not advertise the framework', () => {
    expect(config.poweredByHeader).toBe(false);
  });

  it('sets the baseline headers on every route', async () => {
    delete process.env.ALLOW_SEARCH_INDEXING;
    const set = await headers();

    expect(set.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(set.get('X-Content-Type-Options')).toBe('nosniff');
    expect(set.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(set.get('X-Frame-Options')).toBe('DENY');
    expect(set.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(set.get('Permissions-Policy')).toContain('camera=()');
  });

  it('keeps staging out of search results by default', async () => {
    delete process.env.ALLOW_SEARCH_INDEXING;
    expect((await headers()).get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });

  it('allows indexing only when the build opts in', async () => {
    process.env.ALLOW_SEARCH_INDEXING = 'true';
    expect((await headers()).has('X-Robots-Tag')).toBe(false);
    expect(robots()).toEqual({ rules: { userAgent: '*', allow: '/' } });
  });
});

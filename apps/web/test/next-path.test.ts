import { describe, expect, it } from 'vitest';
import { safeNextPath, signInPath } from '../src/lib/next-path';

describe('post-auth redirects', () => {
  it('keeps same-origin absolute paths and their query strings', () => {
    expect(safeNextPath('/')).toBe('/');
    expect(safeNextPath('/comparisons/abc?model=llama')).toBe('/comparisons/abc?model=llama');
  });

  it('falls back to the Board for off-site, protocol-relative and missing values', () => {
    for (const value of [
      undefined,
      null,
      '',
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      '/\t/evil.test',
      '/\n/evil.test',
      '/\u007f/evil.test',
      'javascript:alert(1)',
    ]) {
      expect(safeNextPath(value)).toBe('/');
    }
  });

  it('only adds a next parameter when there is a destination', () => {
    expect(signInPath('/')).toBe('/sign-in');
    expect(signInPath('/new')).toBe('/sign-in?next=%2Fnew');
    expect(signInPath('https://evil.test')).toBe('/sign-in');
  });
});

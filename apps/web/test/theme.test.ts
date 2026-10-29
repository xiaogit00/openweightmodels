import { describe, expect, it } from 'vitest';
import { themeFromCookie } from '../src/lib/theme';

describe('themeFromCookie', () => {
  it('accepts the two explicit themes', () => {
    expect(themeFromCookie('light')).toBe('light');
    expect(themeFromCookie('dark')).toBe('dark');
  });

  it('treats system and every other value as follow-the-OS', () => {
    for (const value of ['system', '', 'LIGHT', 'sepia', null, undefined]) {
      expect(themeFromCookie(value)).toBe('system');
    }
  });
});

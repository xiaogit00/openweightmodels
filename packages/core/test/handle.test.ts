import { describe, expect, it } from 'vitest';
import { checkHandle } from '../src/index';

describe('handle validation', () => {
  it('normalises case and surrounding whitespace', () => {
    expect(checkHandle('  Mira  ')).toEqual({ ok: true, handle: 'mira' });
    expect(checkHandle('MiXeD-Case_1')).toEqual({ ok: true, handle: 'mixed-case_1' });
  });

  it('accepts lowercase letters, numbers, hyphens and underscores', () => {
    for (const handle of ['ana', 'mira-2', 'kev_99', 'a1b', 'reader-01a2b3c4d5']) {
      expect(checkHandle(handle)).toEqual({ ok: true, handle });
    }
  });

  it('rejects lengths outside 3–30 characters', () => {
    expect(checkHandle('ab')).toMatchObject({ ok: false });
    expect(checkHandle('a'.repeat(31))).toMatchObject({ ok: false });
    expect(checkHandle('a'.repeat(30))).toEqual({ ok: true, handle: 'a'.repeat(30) });
  });

  it('rejects handles that do not start and end with a letter or number', () => {
    for (const handle of ['-mira', 'mira-', '_mira', 'mira_', 'mi ra', 'mira!', 'mïra']) {
      expect(checkHandle(handle)).toMatchObject({ ok: false });
    }
  });

  it('reserves route and platform names', () => {
    for (const handle of ['admin', 'api', 'auth', 'sign-in', 'onboarding', 'openweightmodels', 'me']) {
      expect(checkHandle(handle)).toMatchObject({ ok: false });
    }
    expect(checkHandle('admin')).toMatchObject({ message: expect.stringContaining('reserved') });
  });

  it('rejects an empty handle', () => {
    expect(checkHandle('   ')).toMatchObject({ ok: false });
  });
});

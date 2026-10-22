import { describe, expect, it } from 'vitest';
import {
  CursorError,
  decodeCursor,
  encodeCursor,
  type CursorPayload,
} from '../src/domain/cursor';

function errorCode(action: () => unknown) {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof CursorError ? error.code : 'unexpected';
  }
}

function encoded(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

const live: CursorPayload = {
  sort: 'live',
  id: '0192f3f4-0000-7000-8000-000000000000',
  publishedAt: '2026-10-22T10:00:00.000Z',
  createdAt: '2026-10-22T09:00:00.000Z',
};

describe('keyset cursors', () => {
  it('round-trips a live cursor', () => {
    expect(decodeCursor(encodeCursor(live))).toEqual(live);
  });

  it('round-trips a new cursor with no publish date', () => {
    const payload: CursorPayload = {
      ...live,
      sort: 'new',
      publishedAt: null,
    };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('round-trips a top cursor with its score', () => {
    const payload: CursorPayload = { ...live, sort: 'top', score: 7 };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('produces an opaque URL-safe string without padding', () => {
    const cursor = encodeCursor(live);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain('=');
    expect(cursor).not.toContain('+');
    expect(cursor).not.toContain('/');
  });

  it('rejects a cursor that is not valid base64url JSON', () => {
    expect(errorCode(() => decodeCursor('not-a-cursor'))).toBe('invalid_cursor');
    expect(errorCode(() => decodeCursor(Buffer.from('hello').toString('base64url')))).toBe(
      'invalid_cursor',
    );
    expect(errorCode(() => decodeCursor(''))).toBe('invalid_cursor');
  });

  it('rejects an unknown sort', () => {
    expect(errorCode(() => decodeCursor(encoded({ ...live, sort: 'oldest' })))).toBe(
      'invalid_cursor',
    );
  });

  it('rejects missing and mistyped fields', () => {
    expect(errorCode(() => decodeCursor(encoded({ sort: 'live', id: live.id })))).toBe(
      'invalid_cursor',
    );
    expect(errorCode(() => decodeCursor(encoded({ ...live, id: 42 })))).toBe('invalid_cursor');
    expect(errorCode(() => decodeCursor(encoded({ ...live, createdAt: false })))).toBe(
      'invalid_cursor',
    );
    expect(
      errorCode(() => decodeCursor(encoded({ ...live, publishedAt: undefined }))),
    ).toBe('invalid_cursor');
    expect(errorCode(() => decodeCursor(encoded({ ...live, score: 'seven' })))).toBe(
      'invalid_cursor',
    );
  });

  it('rejects a Top cursor without a score', () => {
    expect(errorCode(() => decodeCursor(encoded({ ...live, sort: 'top' })))).toBe(
      'invalid_cursor',
    );
  });

  it('rejects a payload that is not an object', () => {
    expect(errorCode(() => decodeCursor(encoded(null)))).toBe('invalid_cursor');
    expect(errorCode(() => decodeCursor(encoded([])))).toBe('invalid_cursor');
    expect(errorCode(() => decodeCursor(encoded('live')))).toBe('invalid_cursor');
  });
});

import type { Sort } from './types';

export type CursorPayload = {
  sort: Sort;
  id: string;
  publishedAt: string | null;
  createdAt: string;
  score?: number;
};

export class CursorError extends Error {
  readonly code = 'invalid_cursor';
  readonly status = 400;

  constructor() {
    super('That page cursor is not valid.');
    this.name = 'CursorError';
  }
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<
      CursorPayload
    >;
    if (
      !parsed ||
      (parsed.sort !== 'live' && parsed.sort !== 'top' && parsed.sort !== 'new') ||
      typeof parsed.id !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      !(parsed.publishedAt === null || typeof parsed.publishedAt === 'string') ||
      (parsed.score !== undefined && typeof parsed.score !== 'number')
    ) {
      throw new CursorError();
    }
    return parsed as CursorPayload;
  } catch {
    throw new CursorError();
  }
}

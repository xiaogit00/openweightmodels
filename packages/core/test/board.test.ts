import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import {
  CursorError,
  closeDb,
  closeRedis,
  decodeCursor,
  listComparisons,
  softDeleteComparison,
} from '../src/index';
import { createJobFixture, servicesAvailable, type FixtureOptions } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; Board tests skipped');
}

afterAll(async () => {
  await closeRedis();
  await closeDb();
});

type Fixture = Awaited<ReturnType<typeof createJobFixture>>;

async function publishedFixture(
  prefix: string,
  options: FixtureOptions = {},
): Promise<Fixture> {
  return createJobFixture({
    titlePrefix: prefix,
    comparisonStatus: 'published',
    runStatus: 'done',
    ...options,
  });
}

async function cleanupAll(fixtures: Fixture[]) {
  await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
}

function ids(items: Array<{ id: string }>) {
  return items.map((item) => item.id);
}

describe.skipIf(!available)('Board listing', () => {
  it('pages a filtered list with an opaque cursor and no duplicates', async () => {
    const prefix = `Pagination ${uuidv7().slice(-8)}`;
    const older = await publishedFixture(prefix, {
      publishedAt: new Date('2026-10-20T10:00:00.000Z'),
      createdAt: new Date('2026-10-20T09:00:00.000Z'),
    });
    const middle = await publishedFixture(prefix, {
      publishedAt: new Date('2026-10-21T10:00:00.000Z'),
      createdAt: new Date('2026-10-21T09:00:00.000Z'),
    });
    const newer = await publishedFixture(prefix, {
      publishedAt: new Date('2026-10-22T10:00:00.000Z'),
      createdAt: new Date('2026-10-22T09:00:00.000Z'),
    });

    try {
      const first = await listComparisons({ q: prefix, sort: 'live', limit: 2 });
      expect(first.total).toBe(3);
      expect(ids(first.items)).toEqual([newer.comparisonId, middle.comparisonId]);
      expect(first.nextCursor).toBeTruthy();
      expect(decodeCursor(first.nextCursor!)).toMatchObject({ sort: 'live' });

      const second = await listComparisons({
        q: prefix,
        sort: 'live',
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(second.total).toBe(3);
      expect(ids(second.items)).toEqual([older.comparisonId]);
      expect(second.nextCursor).toBeNull();
    } finally {
      await cleanupAll([older, middle, newer]);
    }
  });

  it('sorts Top by score, then publish time, and pages without repeating a tie', async () => {
    const prefix = `Top ${uuidv7().slice(-8)}`;
    const low = await publishedFixture(prefix, {
      commentCount: 1,
      annotationCount: 0,
      publishedAt: new Date('2026-10-22T10:00:00.000Z'),
    });
    const tiedOld = await publishedFixture(prefix, {
      commentCount: 1,
      annotationCount: 1,
      publishedAt: new Date('2026-10-20T10:00:00.000Z'),
    });
    const tiedNew = await publishedFixture(prefix, {
      commentCount: 3,
      annotationCount: 0,
      publishedAt: new Date('2026-10-21T10:00:00.000Z'),
    });

    try {
      const first = await listComparisons({ q: prefix, sort: 'top', limit: 2 });
      expect(first.total).toBe(3);
      expect(ids(first.items)).toEqual([tiedNew.comparisonId, tiedOld.comparisonId]);
      expect(first.nextCursor).toBeTruthy();
      expect(decodeCursor(first.nextCursor!)).toMatchObject({ sort: 'top', score: 3 });

      const second = await listComparisons({
        q: prefix,
        sort: 'top',
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(ids(second.items)).toEqual([low.comparisonId]);
      expect(second.nextCursor).toBeNull();
    } finally {
      await cleanupAll([low, tiedOld, tiedNew]);
    }
  });

  it('sorts New by creation time', async () => {
    const prefix = `New ${uuidv7().slice(-8)}`;
    const older = await publishedFixture(prefix, {
      createdAt: new Date('2026-10-20T09:00:00.000Z'),
      publishedAt: new Date('2026-10-22T10:00:00.000Z'),
    });
    const newer = await publishedFixture(prefix, {
      createdAt: new Date('2026-10-21T09:00:00.000Z'),
      publishedAt: new Date('2026-10-21T10:00:00.000Z'),
    });

    try {
      const list = await listComparisons({ q: prefix, sort: 'new' });
      expect(ids(list.items)).toEqual([newer.comparisonId, older.comparisonId]);
    } finally {
      await cleanupAll([older, newer]);
    }
  });

  it('filters by Category, Model and effort in SQL', async () => {
    const prefix = `Filter ${uuidv7().slice(-8)}`;
    const coding = await publishedFixture(prefix, {
      categories: ['Coding'],
      effort: 2,
    });
    const reasoning = await publishedFixture(prefix, {
      categories: ['Reasoning'],
      effort: 3,
    });

    try {
      expect(
        ids((await listComparisons({ q: prefix, cat: 'Coding' })).items),
      ).toEqual([coding.comparisonId]);
      expect(
        ids((await listComparisons({ q: prefix, cat: 'Reasoning' })).items),
      ).toEqual([reasoning.comparisonId]);
      expect(ids((await listComparisons({ q: prefix, effort: 3 })).items)).toEqual([
        reasoning.comparisonId,
      ]);
      expect(
        ids(
          (
            await listComparisons({
              q: prefix,
              models: [coding.challengerSlugs[0]!],
            })
          ).items,
        ),
      ).toEqual([coding.comparisonId]);
      expect(
        ids((await listComparisons({ q: prefix, models: ['not-a-real-slug'] })).items),
      ).toEqual([]);
    } finally {
      await cleanupAll([coding, reasoning]);
    }
  });

  it('excludes drafts and deleted Comparisons', async () => {
    const prefix = `Visibility ${uuidv7().slice(-8)}`;
    const draft = await createJobFixture({
      titlePrefix: prefix,
      comparisonStatus: 'generating',
    });
    const deleted = await publishedFixture(prefix);
    await softDeleteComparison(deleted.comparisonId, deleted.userId);

    try {
      const list = await listComparisons({ q: prefix });
      expect(list.total).toBe(0);
      expect(list.items).toEqual([]);
    } finally {
      await cleanupAll([draft, deleted]);
    }
  });

  it('rejects a cursor minted for a different sort', async () => {
    const prefix = `Cursor ${uuidv7().slice(-8)}`;
    const first = await publishedFixture(prefix, {
      publishedAt: new Date('2026-10-22T10:00:00.000Z'),
    });
    const second = await publishedFixture(prefix, {
      publishedAt: new Date('2026-10-21T10:00:00.000Z'),
    });

    try {
      const page = await listComparisons({ q: prefix, sort: 'live', limit: 1 });
      expect(page.nextCursor).toBeTruthy();

      await expect(
        listComparisons({ q: prefix, sort: 'top', cursor: page.nextCursor }),
      ).rejects.toBeInstanceOf(CursorError);
    } finally {
      await cleanupAll([first, second]);
    }
  });
});

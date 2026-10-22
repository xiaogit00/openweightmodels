import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import {
  CursorError,
  closeDb,
  closeRedis,
  decodeCursor,
  getBoardFacets,
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

  it('returns 48 items per page by default and a cursor for the rest', async () => {
    const prefix = `Page size ${uuidv7().slice(-8)}`;
    const fixtures: Fixture[] = [];
    for (let index = 0; index < 49; index += 1) {
      fixtures.push(
        await publishedFixture(prefix, {
          publishedAt: new Date(Date.UTC(2026, 9, 1, 12, index)),
          createdAt: new Date(Date.UTC(2026, 8, 1, 12, index)),
        }),
      );
    }

    try {
      const first = await listComparisons({ q: prefix });
      expect(first.items).toHaveLength(48);
      expect(first.total).toBe(49);
      expect(first.nextCursor).toBeTruthy();

      const second = await listComparisons({ q: prefix, cursor: first.nextCursor });
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();

      const firstPageIds = new Set(first.items.map((item) => item.id));
      expect(firstPageIds.size).toBe(48);
      expect(firstPageIds.has(second.items[0]!.id)).toBe(false);
    } finally {
      await cleanupAll(fixtures);
    }
  });

  it('reports global Category and Model counts for published Comparisons', async () => {
    const prefix = `Facets ${uuidv7().slice(-8)}`;
    const before = await getBoardFacets();
    const published = await publishedFixture(prefix, {
      categories: ['Coding'],
      challengers: 2,
    });
    const draft = await createJobFixture({
      titlePrefix: prefix,
      comparisonStatus: 'generating',
      categories: ['Reasoning'],
    });
    const deleted = await publishedFixture(prefix, { categories: ['Math'] });
    await softDeleteComparison(deleted.comparisonId, deleted.userId);

    try {
      const after = await getBoardFacets();
      expect(after.total).toBe(before.total + 1);
      expect(after.categories.Coding).toBe((before.categories.Coding ?? 0) + 1);
      expect(after.models[published.baseModelSlug]).toBe(1);
      for (const slug of published.challengerSlugs) {
        expect(after.models[slug]).toBe(1);
      }
      expect(after.models[draft.challengerSlugs[0]!]).toBeUndefined();
      expect(after.models[deleted.challengerSlugs[0]!]).toBeUndefined();
    } finally {
      await cleanupAll([published, draft, deleted]);
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

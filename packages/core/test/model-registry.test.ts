import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import {
  MODEL_REGISTRY,
  closeDb,
  closeRedis,
  getDb,
  models,
  syncModelRegistry,
  type Db,
} from '../src/index';
import { servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; model registry tests skipped');
}

afterAll(async () => {
  await closeRedis();
  await closeDb();
});

class Rollback extends Error {}

describe.skipIf(!available)('production model registry', () => {
  it('upserts the curated registry without touching enabled state', async () => {
    const db = getDb();
    const slugs = MODEL_REGISTRY.map((entry) => entry.slug);
    const before = await db
      .select({ slug: models.slug, enabled: models.enabled })
      .from(models)
      .where(inArray(models.slug, slugs));
    const existed = new Map(before.map((row) => [row.slug, row.enabled]));

    // Everything happens in a transaction that is always rolled back, so the
    // development database is never left with disabled Models.
    await expect(
      db.transaction(async (tx) => {
        if (existed.size) {
          await tx
            .update(models)
            .set({ enabled: false, displayName: 'stale' })
            .where(inArray(models.slug, [...existed.keys()]));
        }

        expect(await syncModelRegistry(tx as unknown as Db)).toBe(MODEL_REGISTRY.length);
        expect(await syncModelRegistry(tx as unknown as Db)).toBe(MODEL_REGISTRY.length);

        const rows = await tx.select().from(models).where(inArray(models.slug, slugs));

        expect(rows).toHaveLength(MODEL_REGISTRY.length);
        for (const entry of MODEL_REGISTRY) {
          const row = rows.find((candidate) => candidate.slug === entry.slug);
          expect(row, entry.slug).toBeDefined();
          expect(row).toMatchObject({
            displayName: entry.displayName,
            monogram: entry.monogram,
            provider: entry.provider,
            apiBase: entry.apiBase,
            apiModelId: entry.apiModelId,
            etaSeconds: entry.etaSeconds,
            // A release must not re-enable a Model an Admin disabled; newly
            // inserted Models are enabled.
            enabled: existed.get(entry.slug) === undefined ? true : false,
          });
        }

        throw new Rollback('rollback the registry fixture');
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});

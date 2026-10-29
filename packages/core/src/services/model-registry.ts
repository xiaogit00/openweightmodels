import { notInArray } from 'drizzle-orm';
import { getDb, type Db } from '../db/client';
import { models } from '../db/schema';
import { MODEL_REGISTRY, modelRegistryRows } from '../model-registry';

/**
 * Installs or refreshes the curated Model registry in production. It never
 * touches `enabled` for catalogue entries: an Admin's disable survives a
 * release. Rows that have been removed from the catalogue are disabled rather
 * than deleted, so old Comparisons and Responses keep resolving while the
 * retired Model disappears from pickers. No users, Comparisons or other content
 * are created.
 */
export async function syncModelRegistry(db: Db = getDb()) {
  const rows = new Map(modelRegistryRows().map((row) => [row.slug, row]));

  for (const entry of MODEL_REGISTRY) {
    const row = rows.get(entry.slug);
    if (!row) throw new Error(`registry entry ${entry.slug} is missing from its rows`);
    await db
      .insert(models)
      .values(row)
      .onConflictDoUpdate({
        target: models.slug,
        set: {
          displayName: entry.displayName,
          monogram: entry.monogram,
          provider: entry.provider,
          apiBase: entry.apiBase,
          apiModelId: entry.apiModelId,
          etaSeconds: entry.etaSeconds,
          openWeights: entry.openWeights,
        },
      });
  }

  await db
    .update(models)
    .set({ enabled: false })
    .where(
      notInArray(
        models.slug,
        MODEL_REGISTRY.map((entry) => entry.slug),
      ),
    );

  return MODEL_REGISTRY.length;
}

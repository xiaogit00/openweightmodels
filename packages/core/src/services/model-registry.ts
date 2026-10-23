import { getDb, type Db } from '../db/client';
import { models } from '../db/schema';
import { MODEL_REGISTRY, modelRegistryRows } from '../model-registry';

/**
 * Installs or refreshes the curated Model registry in production. It never
 * touches `enabled`: an Admin's disable survives a release. No users,
 * Comparisons or other content are created.
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
        },
      });
  }

  return MODEL_REGISTRY.length;
}

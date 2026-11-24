/**
 * Production database bootstrap: apply migrations, then install the curated
 * Model registry. It deliberately does not seed development content; the
 * production database must never contain fake users or Comparisons.
 */
import { loadEnv } from '../load-env';
import { syncModelRegistry } from '../services/model-registry';
import { syncPresetCategories } from '../services/categories';
import { runAsScript } from './run-script';
import { runMigrations } from './migrate';

loadEnv();

export async function bootstrapDatabase() {
  await runMigrations();
  const models = await syncModelRegistry();
  const categories = await syncPresetCategories();
  console.log(`[db:bootstrap] model registry synced (${models} models)`);
  console.log(`[db:bootstrap] preset categories synced (${categories} categories)`);
}

runAsScript(import.meta.url, bootstrapDatabase);

/**
 * Idempotent database bootstrap for the local stack: apply migrations, then
 * seed only when the database has no content. It never truncates existing
 * data, so `docker compose up` can run it on every start. Use `pnpm db:seed`
 * when you explicitly want to replace the content.
 */
import { count } from 'drizzle-orm';
import { loadEnv } from '../load-env';
import { seedDatabase } from '../seed';
import { getDb } from './client';
import { runMigrations } from './migrate';
import { runAsScript } from './run-script';
import { comparisons, users } from './schema';

loadEnv();

export async function initDatabase() {
  await runMigrations();

  const db = getDb();
  // Users and Comparisons are the roots of all content; seed only when both
  // are empty so a truncated-but-unseeded or partially deleted database heals.
  const [[userRow], [comparisonRow]] = await Promise.all([
    db.select({ total: count() }).from(users),
    db.select({ total: count() }).from(comparisons),
  ]);
  const hasContent = Number(userRow?.total ?? 0) + Number(comparisonRow?.total ?? 0) > 0;
  if (hasContent) {
    console.log('[db:init] data present, skipping seed');
    return;
  }

  console.log('[db:init] empty database, seeding development data');
  await seedDatabase();
}

runAsScript(import.meta.url, initDatabase);

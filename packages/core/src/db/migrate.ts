import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEnv } from '../load-env';
import { getDb } from './client';
import { runAsScript } from './run-script';

loadEnv();

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../drizzle');

export async function runMigrations() {
  const db = getDb();
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');
}

runAsScript(import.meta.url, runMigrations);

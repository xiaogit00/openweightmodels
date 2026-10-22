import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getDb, closeDb } from './client';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../drizzle');

async function main() {
  const db = getDb();
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});

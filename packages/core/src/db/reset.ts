import { getSql, closeDb } from './client';
import { loadEnv } from '../load-env';

loadEnv();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to reset a production database');
  }
  const sql = getSql();
  await sql.unsafe('drop schema public cascade; create schema public;');
  console.log('database reset');
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});

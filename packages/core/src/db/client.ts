import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type Sql = ReturnType<typeof postgres>;
type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __owmSql?: Sql;
  __owmDb?: Db;
};

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  return url;
}

export function getSql(): Sql {
  if (!globalForDb.__owmSql) {
    globalForDb.__owmSql = postgres(databaseUrl(), {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      prepare: false,
      onnotice: () => {},
    });
  }
  return globalForDb.__owmSql;
}

export function getDb(): Db {
  if (!globalForDb.__owmDb) {
    globalForDb.__owmDb = drizzle(getSql(), { schema });
  }
  return globalForDb.__owmDb;
}

export async function closeDb() {
  if (globalForDb.__owmSql) {
    await globalForDb.__owmSql.end({ timeout: 5 });
    globalForDb.__owmSql = undefined;
    globalForDb.__owmDb = undefined;
  }
}

export type { Db };

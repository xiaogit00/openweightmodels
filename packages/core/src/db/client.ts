import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type Sql = ReturnType<typeof postgres>;
type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __owmSql?: Sql;
  __owmDb?: Db;
};

export type DbEnv = Record<string, string | undefined>;

/**
 * Resolves the connection URL from either `DATABASE_URL` or the discrete
 * variables an ECS task receives. Production never puts a password in a plain
 * environment variable: `DB_USER`/`DB_PASSWORD` are injected from Secrets
 * Manager and assembled here, with each part URL-encoded.
 */
export function databaseUrlFromEnv(env: DbEnv = process.env): string {
  const configured = env.DATABASE_URL?.trim();
  if (configured) return configured;

  const host = env.DB_HOST?.trim();
  const user = env.DB_USER?.trim();
  const password = env.DB_PASSWORD;
  const database = env.DB_NAME?.trim() || 'openweightmodels';
  const port = env.DB_PORT?.trim() || '5432';

  if (!host) {
    throw new Error(
      'DATABASE_URL is not set, and DB_HOST is missing (set DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD)',
    );
  }
  if (!user || !password) {
    throw new Error('DB_USER and DB_PASSWORD must be set when DATABASE_URL is not set');
  }

  const ssl = env.DB_SSL === 'true' ? '?sslmode=require' : '';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}${ssl}`;
}

export function hasDatabaseConfig(env: DbEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim() || env.DB_HOST?.trim());
}

export function getSql(): Sql {
  if (!globalForDb.__owmSql) {
    globalForDb.__owmSql = postgres(databaseUrlFromEnv(), {
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

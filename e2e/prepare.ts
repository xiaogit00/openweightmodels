/**
 * Prepares an isolated database and Redis database for the browser suite, then
 * applies migrations and the deterministic dev seed.
 *
 * Run through `pnpm test:e2e`. Override with E2E_DATABASE_URL / E2E_REDIS_URL.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgres://localhost:5432/openweightmodels_e2e';
const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1';

if (process.env.DATABASE_URL && process.env.DATABASE_URL === databaseUrl) {
  throw new Error(
    'E2E refuses to seed the development database. Point E2E_DATABASE_URL at a dedicated database.',
  );
}

const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\//, '');
if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
  throw new Error(`Unsupported E2E database name: ${databaseName}`);
}

const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  execFileSync(command, args, { cwd: root, env, stdio: 'inherit' });
}

function databaseExists() {
  try {
    const output = execFileSync(
      'psql',
      [
        adminUrl.toString(),
        '-tAc',
        `select 1 from pg_database where datname = '${databaseName}'`,
      ],
      { encoding: 'utf8' },
    );
    return output.trim() === '1';
  } catch (error) {
    throw new Error(
      `Could not reach Postgres at ${adminUrl.toString()}. Start it with 'brew services start postgresql@17'.\n${String(
        error,
      )}`,
    );
  }
}

if (!databaseExists()) {
  console.log(`[e2e] creating database ${databaseName}`);
  run('psql', [adminUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `create database "${databaseName}"`]);
}

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  NODE_ENV: 'test',
};

console.log('[e2e] flushing the E2E Redis database');
run('redis-cli', ['-u', redisUrl, 'FLUSHDB'], env);

console.log('[e2e] applying migrations');
run('pnpm', ['--filter', '@owm/core', 'exec', 'tsx', 'src/db/migrate.ts'], env);

console.log('[e2e] seeding deterministic data');
run('pnpm', ['--filter', '@owm/core', 'exec', 'tsx', 'src/seed.ts'], env);

console.log(`[e2e] ready: ${databaseName}`);

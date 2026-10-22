/**
 * Prepares an isolated database and Redis database for the browser suite, then
 * applies migrations and the deterministic dev seed.
 *
 * Run through `pnpm test:e2e`. Override with E2E_DATABASE_URL / E2E_REDIS_URL.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseUrl, redisUrl, serverEnv } from './config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Read the local defaults so the guards below can compare against them, while
// E2E_* overrides (already in process.env) still win.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\//, '');
if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
  throw new Error(`Unsupported E2E database name: ${databaseName}`);
}

function sameDatabase(left: string, right: string) {
  const a = new URL(left);
  const b = new URL(right);
  return a.hostname === b.hostname && a.port === b.port && a.pathname === b.pathname;
}

function sameRedisDatabase(left: string, right: string) {
  const a = new URL(left);
  const b = new URL(right);
  const db = (url: URL) => url.pathname.replace(/^\//, '') || '0';
  return a.hostname === b.hostname && a.port === b.port && db(a) === db(b);
}

if (process.env.DATABASE_URL && sameDatabase(process.env.DATABASE_URL, databaseUrl)) {
  throw new Error(
    'E2E refuses to seed the development database. Point E2E_DATABASE_URL at a dedicated database.',
  );
}
if (process.env.REDIS_URL && sameRedisDatabase(process.env.REDIS_URL, redisUrl)) {
  throw new Error(
    'E2E refuses to flush the development Redis database. Point E2E_REDIS_URL at a dedicated DB index.',
  );
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

const env = { ...process.env, ...serverEnv, NODE_ENV: 'test' };

console.log('[e2e] flushing the E2E Redis database');
run('redis-cli', ['-u', redisUrl, 'FLUSHDB'], env);

console.log('[e2e] applying migrations');
run('pnpm', ['--filter', '@owm/core', 'exec', 'tsx', 'src/db/migrate.ts'], env);

console.log('[e2e] seeding deterministic data');
run('pnpm', ['--filter', '@owm/core', 'exec', 'tsx', 'src/seed.ts'], env);

console.log(`[e2e] ready: ${databaseName}`);

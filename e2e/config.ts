/** Single source of truth for the browser suite's ports and service targets. */

export const webPort = 3100;
export const workerReadyPort = 3199;
export const baseUrl = `http://localhost:${webPort}`;

export const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgres://localhost:5432/openweightmodels_e2e';
export const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1';

/** Shared by the web and worker servers so both read the same E2E services. */
export const serverEnv: Record<string, string> = {
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  APP_URL: baseUrl,
  BETTER_AUTH_SECRET: 'openweightmodels-e2e-secret-change-me',
  MAGIC_LINK_RATE_LIMIT_MAX: '50',
  ALLOW_DEV_USER_SWITCH: 'true',
  PROVIDER: 'mock',
  MOCK_DELAY_MS: '5',
  MOCK_FAIL_ONCE: 'false',
  MAX_CHALLENGERS: '4',
  JOBS_PER_HOUR: '50',
  RUNS_PER_DAY: '200',
  PROVIDER_CONCURRENCY: '4',
};

import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_WEB_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgres://localhost:5432/openweightmodels_e2e';
const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1';

/** Shared by the web and worker servers so both read the same E2E services. */
const env = {
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  NEXT_PUBLIC_APP_URL: baseURL,
  DEV_DEFAULT_USER: 'mira',
  ALLOW_DEV_USER_SWITCH: 'true',
  PROVIDER: 'mock',
  MOCK_DELAY_MS: '5',
  MOCK_FAIL_ONCE: 'false',
  MAX_CHALLENGERS: '4',
  JOBS_PER_HOUR: '50',
  RUNS_PER_DAY: '200',
  PROVIDER_CONCURRENCY: '4',
  E2E_WORKER_READY_PORT: '3199',
};

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: [
    {
      name: 'web',
      command: `pnpm --filter @owm/web exec next dev -p ${port}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 240_000,
      env,
    },
    {
      name: 'worker',
      command: 'pnpm exec tsx e2e/worker-server.ts',
      port: 3199,
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
      env,
    },
  ],
});

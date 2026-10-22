import { defineConfig } from '@playwright/test';
import { baseUrl, serverEnv, webPort, workerReadyPort } from './e2e/config';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: [
    {
      name: 'web',
      command: `pnpm --filter @owm/web exec next dev -p ${webPort}`,
      url: baseUrl,
      reuseExistingServer: false,
      timeout: 240_000,
      env: serverEnv,
    },
    {
      name: 'worker',
      command: 'pnpm exec tsx e2e/worker-server.ts',
      port: workerReadyPort,
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
      env: serverEnv,
    },
  ],
});

import { loadEnv } from '@owm/core/env';
import { assertProviderConfigured } from '@owm/core';

loadEnv();

const missing = ['DATABASE_URL', 'REDIS_URL'].filter(
  (key) => !process.env[key]?.trim(),
);

if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

assertProviderConfigured();

import { loadEnv } from '@owm/core/env';
import {
  assertProviderConfigured,
  hasDatabaseConfig,
  hasRedisConfig,
} from '@owm/core';

loadEnv();

const missing: string[] = [];
if (!hasDatabaseConfig()) {
  missing.push('DATABASE_URL (or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD)');
}
if (!hasRedisConfig()) {
  missing.push('REDIS_URL (or REDIS_HOST/REDIS_PORT)');
}

if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

assertProviderConfigured();

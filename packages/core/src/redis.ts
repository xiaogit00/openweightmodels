import Redis, { type RedisOptions } from 'ioredis';

const globalForRedis = globalThis as unknown as {
  __owmRedis?: Redis;
};

export type RedisEnv = Record<string, string | undefined>;

/**
 * Resolves the Redis connection from `REDIS_URL`, the local default, or the
 * discrete host/port/TLS variables an ECS task receives. ElastiCache is
 * reachable only inside the VPC, so staging uses in-transit TLS instead of an
 * AUTH token.
 */
export function redisConnectionConfig(env: RedisEnv = process.env): string | RedisOptions {
  const url = env.REDIS_URL?.trim();
  if (url) return url;

  const host = env.REDIS_HOST?.trim();
  if (!host) return 'redis://localhost:6379';

  return {
    host,
    port: Number(env.REDIS_PORT?.trim() || 6379),
    password: env.REDIS_PASSWORD || undefined,
    tls: env.REDIS_TLS === 'true' ? {} : undefined,
  };
}

export function hasRedisConfig(env: RedisEnv = process.env): boolean {
  return Boolean(env.REDIS_URL?.trim() || env.REDIS_HOST?.trim());
}

export function getRedis(): Redis {
  if (!globalForRedis.__owmRedis) {
    globalForRedis.__owmRedis = connect({
      maxRetriesPerRequest: 2,
      connectTimeout: 2_000,
      retryStrategy: (times: number) => Math.min(times * 200, 2_000),
    });
  }
  return globalForRedis.__owmRedis;
}

function connect(options: RedisOptions): Redis {
  const config = redisConnectionConfig();
  if (typeof config === 'string') return new Redis(config, options);
  return new Redis({ ...config, ...options });
}

export function createRedisConnection(): Redis {
  return connect({
    maxRetriesPerRequest: null,
    connectTimeout: 2_000,
  });
}

export function createSubscriber(): Redis {
  return connect({
    maxRetriesPerRequest: null,
    connectTimeout: 2_000,
  });
}

export const BOARD_CHANNEL = 'owm:board';
export const jobChannel = (jobId: string) => `owm:job:${jobId}`;

export async function publish(channel: string, message: unknown) {
  try {
    await getRedis().publish(channel, JSON.stringify(message));
  } catch (error) {
    console.error('[redis] publish failed', error);
  }
}

export async function closeRedis() {
  const redis = globalForRedis.__owmRedis;
  if (!redis) return;
  globalForRedis.__owmRedis = undefined;
  await redis.quit().catch(() => redis.disconnect());
}

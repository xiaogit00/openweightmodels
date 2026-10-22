import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  __owmRedis?: Redis;
};

function redisUrl() {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

export function getRedis(): Redis {
  if (!globalForRedis.__owmRedis) {
    globalForRedis.__owmRedis = new Redis(redisUrl(), {
      maxRetriesPerRequest: 2,
      connectTimeout: 2_000,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
  }
  return globalForRedis.__owmRedis;
}

export function createRedisConnection(): Redis {
  return new Redis(redisUrl(), {
    maxRetriesPerRequest: null,
    connectTimeout: 2_000,
  });
}

export function createSubscriber(): Redis {
  return new Redis(redisUrl(), {
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

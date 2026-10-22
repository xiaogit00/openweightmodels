import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export const RUN_QUEUE = 'owm-runs';
export const AUTO_SKIP_DELAY_MS = Number(process.env.AUTO_SKIP_DELAY_MS ?? 24 * 60 * 60 * 1000);

const globalForQueue = globalThis as unknown as {
  __owmRunQueue?: Queue;
};

export function getRunQueue(): Queue {
  if (!globalForQueue.__owmRunQueue) {
    globalForQueue.__owmRunQueue = new Queue(RUN_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 200,
        attempts: 1,
      },
    });
  }
  return globalForQueue.__owmRunQueue;
}

export async function enqueueRun(responseId: string) {
  return getRunQueue().add('run', { responseId });
}

export async function enqueueAutoSkip(responseId: string) {
  return getRunQueue().add(
    'auto-skip',
    { responseId },
    {
      delay: AUTO_SKIP_DELAY_MS,
      jobId: `auto-skip:${responseId}`,
    },
  );
}

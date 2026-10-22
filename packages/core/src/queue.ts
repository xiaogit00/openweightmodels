import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export const RUN_QUEUE = 'owm-runs';
export const AUTO_SKIP_DELAY_MS = Number(process.env.AUTO_SKIP_DELAY_MS ?? 24 * 60 * 60 * 1000);

export function autoSkipJobId(responseId: string, attempt: number) {
  return `auto-skip-${responseId}-${attempt}`;
}

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

export async function enqueueAutoSkip(responseId: string, attempt: number) {
  return getRunQueue().add(
    'auto-skip',
    { responseId },
    {
      delay: AUTO_SKIP_DELAY_MS,
      // Attempt-scoped: a completed job for an earlier attempt must not make
      // BullMQ dedupe the timer for a new failure.
      jobId: autoSkipJobId(responseId, attempt),
    },
  );
}

export async function removeAutoSkip(responseId: string, attempt: number) {
  const job = await getRunQueue().getJob(autoSkipJobId(responseId, attempt));
  if (!job) return;
  try {
    await job.remove();
  } catch {
    // Already active or finished: it will no-op unless the Run is failed.
  }
}

export async function closeRunQueue() {
  const queue = globalForQueue.__owmRunQueue;
  if (!queue) return;
  globalForQueue.__owmRunQueue = undefined;
  await queue.close();
}

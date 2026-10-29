import { Worker, type Job } from 'bullmq';
import {
  RUN_QUEUE,
  autoSkipRun,
  createRedisConnection,
  processRun,
  reportError,
} from '@owm/core';

export type RunWorkerOptions = {
  /** Number of Runs processed at once. Defaults to PROVIDER_CONCURRENCY. */
  concurrency?: number;
};

export async function handleQueueJob(job: Pick<Job, 'name' | 'data'>): Promise<void> {
  const responseId: unknown = job.data?.responseId;
  if (typeof responseId !== 'string' || !responseId) {
    throw new Error(`Job ${job.name} is missing a responseId`);
  }

  switch (job.name) {
    case 'run':
      return processRun(responseId);
    case 'auto-skip':
      return autoSkipRun(responseId);
    default:
      throw new Error(`Unknown job name: ${job.name}`);
  }
}

export function resolveConcurrency(
  value: string | number | undefined = process.env.PROVIDER_CONCURRENCY,
): number {
  const concurrency = Number(value ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('PROVIDER_CONCURRENCY must be a positive integer');
  }
  return concurrency;
}

export function createRunWorker(options: RunWorkerOptions = {}) {
  const concurrency = resolveConcurrency(options.concurrency ?? process.env.PROVIDER_CONCURRENCY);

  const worker = new Worker(RUN_QUEUE, handleQueueJob, {
    connection: createRedisConnection(),
    concurrency,
  });

  worker.on('failed', (job, error) => {
    console.error(`[worker] ${job?.name ?? 'job'} ${job?.id ?? ''} failed`, error);
    void reportError(error, {
      queue: RUN_QUEUE,
      jobId: job?.id,
      jobName: job?.name,
      responseId: job?.data?.responseId,
      attemptsMade: job?.attemptsMade,
    });
  });
  worker.on('error', (error) => {
    console.error('[worker] error', error);
    void reportError(error, { queue: RUN_QUEUE, source: 'worker' });
  });

  return worker;
}

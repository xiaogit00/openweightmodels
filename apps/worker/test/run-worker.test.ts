import { describe, expect, it } from 'vitest';
import {
  closeDb,
  closeRedis,
  closeRunQueue,
  enqueueRun,
  getComparisonForViewer,
  getJobForAuthor,
  getNotifications,
} from '@owm/core';
import { createJobFixture, servicesAvailable } from '@owm/core/testing';
import { createRunWorker, handleQueueJob } from '../src/worker';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; worker integration test skipped');
}

async function waitFor<T>(read: () => Promise<T | null | undefined>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

describe('job dispatch', () => {
  it('rejects a job without a responseId', async () => {
    await expect(handleQueueJob({ name: 'run', data: {} })).rejects.toThrow('responseId');
  });

  it('rejects an unknown job name', async () => {
    await expect(
      handleQueueJob({ name: 'not-a-job', data: { responseId: 'abc' } }),
    ).rejects.toThrow('Unknown job name');
  });
});

describe.skipIf(!available)('run worker', () => {
  it('consumes a queued run, persists it and notifies the author once', async () => {
    const fixture = await createJobFixture();
    const worker = createRunWorker({ concurrency: 1 });

    try {
      await enqueueRun(fixture.runIds[0]!);

      const bundle = await waitFor(async () => {
        const job = await getJobForAuthor(fixture.jobId, fixture.userId);
        return job?.job.status === 'ready' ? job : null;
      });

      expect(bundle.comparison.status).toBe('ready');
      expect(bundle.runs).toHaveLength(1);
      expect(bundle.runs[0]).toMatchObject({ status: 'done', attempt: 0 });
      expect(bundle.runs[0]!.tokens).toBeGreaterThan(0);
      expect(bundle.runs[0]!.latencyMs).toBeGreaterThanOrEqual(0);

      const view = await getComparisonForViewer(fixture.comparisonId, fixture.userId);
      const challenger = view?.responses.find(({ response }) => !response.isBase);
      expect(challenger?.response.contentMd).toContain('sliding');

      const ready = (await getNotifications(fixture.userId)).filter(
        (notification) => notification.kind === 'job.ready',
      );
      expect(ready).toHaveLength(1);
    } finally {
      await worker.close();
      await fixture.cleanup();
      await closeRunQueue();
      await closeRedis();
      await closeDb();
    }
  });
});

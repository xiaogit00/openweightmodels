import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDb,
  closeRedis,
  closeRunQueue,
  createComparison,
  getComparisonForViewer,
  getJobForAuthor,
  getNotifications,
  getRunQueue,
  processRun,
  publishComparison,
} from '../src/index';
import { createJobFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; pipeline tests skipped');
}

afterAll(async () => {
  await closeRunQueue();
  await closeRedis();
  await closeDb();
});

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.MOCK_DELAY_MS = '0';
  process.env.MOCK_FAIL_ONCE = 'false';
});

afterEach(() => {
  for (const key of ['MOCK_DELAY_MS', 'MOCK_FAIL_ONCE']) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function removeQueuedRuns(responseIds: string[]) {
  const queue = getRunQueue();
  const jobs = await queue.getJobs(['wait', 'delayed', 'prioritized']);
  await Promise.all(
    jobs
      .filter((job) => responseIds.includes(String(job.data?.responseId ?? '')))
      .map((job) => job.remove().catch(() => {})),
  );
}

describe.skipIf(!available)('create → generate → publish', () => {
  it('runs an uploaded file through the mock pipeline and publishes it to the Board', async () => {
    const fixture = await createJobFixture({ challengers: 2 });
    const title = `Pipeline ${fixture.comparisonId.slice(-8)}`;
    const fileText = [
      '---',
      'prompt: Write a thread-safe sliding-window rate limiter in Go.',
      `model: ${fixture.baseModelSlug}`,
      '---',
      '',
      '```go',
      'const x = 1',
      '```',
      '',
      'The trade-off is memory.',
    ].join('\n');

    let createdResponseIds: string[] = [];

    try {
      const created = await createComparison({
        authorId: fixture.userId,
        fileName: 'answer.md',
        fileText,
        baseModelId: fixture.baseModelId,
        prompt: '',
        modelIds: fixture.challengerModelIds,
        title,
        categories: ['Coding'],
        effort: 2,
      });

      const queued = await getJobForAuthor(created.jobId, fixture.userId);
      expect(queued?.job.status).toBe('scheduled');
      expect(queued?.comparison.status).toBe('generating');
      expect(queued?.runs.map((run) => run.status)).toEqual(['queued', 'queued']);
      createdResponseIds = queued?.runs.map((run) => run.id) ?? [];

      const draft = await getComparisonForViewer(created.id, fixture.userId);
      const base = draft?.responses.find(({ response }) => response.isBase);
      expect(base?.response.contentMd).toContain('const x = 1');
      expect(base?.response.contentMd).toContain('The trade-off is memory.');
      expect(await getComparisonForViewer(created.id, null)).toBeNull();

      for (const responseId of createdResponseIds) {
        await processRun(responseId);
      }

      const settled = await getJobForAuthor(created.jobId, fixture.userId);
      expect(settled?.job.status).toBe('ready');
      expect(settled?.comparison.status).toBe('ready');
      expect(settled?.runs.every((run) => run.status === 'done')).toBe(true);

      const notifications = (await getNotifications(fixture.userId)).filter(
        (notification) => notification.kind === 'job.ready',
      );
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.payload).toMatchObject({
        jobId: created.jobId,
        comparisonId: created.id,
      });

      const card = await publishComparison(created.id, fixture.userId);
      expect(card.title).toBe(title);
      expect(card.models.length).toBe(3);

      const published = await getComparisonForViewer(created.id, null);
      expect(published?.comparison.status).toBe('published');
      expect(
        published?.responses.filter(({ response }) => response.status === 'done'),
      ).toHaveLength(3);
    } finally {
      await removeQueuedRuns(createdResponseIds);
      await fixture.cleanup();
    }
  });
});

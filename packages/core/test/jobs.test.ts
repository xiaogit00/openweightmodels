import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  autoSkipJobId,
  autoSkipRun,
  closeDb,
  closeRedis,
  closeRunQueue,
  finalizeJob,
  getComparisonForViewer,
  getJobForAuthor,
  getNotifications,
  getRunQueue,
  jobEventsAfter,
  processRun,
  retryRun,
  skipRun,
} from '../src/index';
import { createJobFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; run lifecycle tests skipped');
}
const DAY_MS = 24 * 60 * 60 * 1000;
const originalEnv = { ...process.env };
let scheduledResponses: string[] = [];

async function clearAutoSkip(responseId: string) {
  const job = await getRunQueue().getJob(autoSkipJobId(responseId, 0));
  await job?.remove().catch(() => {});
}

function track<T extends { runIds: string[] }>(fixture: T): T {
  scheduledResponses.push(...fixture.runIds);
  return fixture;
}

beforeEach(() => {
  scheduledResponses = [];
  process.env.MOCK_DELAY_MS = '0';
  process.env.MOCK_FAIL_ONCE = 'false';
});

afterEach(async () => {
  await Promise.all(scheduledResponses.map(clearAutoSkip));
  for (const key of ['MOCK_DELAY_MS', 'MOCK_FAIL_ONCE']) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(async () => {
  await closeRunQueue();
  await closeRedis();
  await closeDb();
});

describe.skipIf(!available)('run lifecycle', () => {
  it('streams a run to done and persists its content, tokens and latency', async () => {
    process.env.MOCK_DELAY_MS = '20';
    const fixture = track(await createJobFixture());

    try {
      await processRun(fixture.runIds[0]!);

      const bundle = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(bundle?.job.status).toBe('ready');
      expect(bundle?.comparison.status).toBe('ready');
      expect(bundle?.runs[0]).toMatchObject({ status: 'done', attempt: 0 });
      expect(bundle!.runs[0]!.tokens).toBeGreaterThan(0);
      expect(bundle!.runs[0]!.latencyMs).toBeGreaterThan(0);

      const view = await getComparisonForViewer(fixture.comparisonId, fixture.userId);
      const challenger = view?.responses.find(({ response }) => !response.isBase);
      expect(challenger?.response.contentMd.length).toBeGreaterThan(0);
      expect(challenger?.response.tokens).toBeGreaterThan(0);

      const events = await jobEventsAfter(fixture.jobId, 0);
      const statuses = events
        .filter((event) => event.kind === 'response.status')
        .map((event) => (event.payload as { status?: string }).status);
      expect(statuses).toEqual(expect.arrayContaining(['calling', 'streaming', 'done']));
      expect(events.some((event) => event.kind === 'job.ready')).toBe(true);

      const ready = (await getNotifications(fixture.userId)).filter(
        (notification) => notification.kind === 'job.ready',
      );
      expect(ready).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('waits for every run before the job and comparison become ready', async () => {
    const fixture = track(await createJobFixture({ challengers: 2 }));

    try {
      await processRun(fixture.runIds[0]!);

      const midway = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(midway?.job.status).toBe('running');
      expect(midway?.comparison.status).toBe('generating');
      expect(midway?.runs.map((run) => run.status).sort()).toEqual(['done', 'queued']);
      expect(await getNotifications(fixture.userId)).toHaveLength(0);

      await processRun(fixture.runIds[1]!);

      const settled = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(settled?.job.status).toBe('ready');
      expect(settled?.comparison.status).toBe('ready');
      expect(settled?.runs.every((run) => run.status === 'done')).toBe(true);
      expect(
        (await getNotifications(fixture.userId)).filter((n) => n.kind === 'job.ready'),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('marks a forced provider failure failed, then retries it to done', async () => {
    process.env.MOCK_FAIL_ONCE = 'true';
    const fixture = track(await createJobFixture());

    try {
      await processRun(fixture.runIds[0]!);

      const failed = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(failed?.runs[0]).toMatchObject({ status: 'failed', attempt: 0 });
      expect(failed?.runs[0]?.error).toContain('API timeout');
      expect(failed?.job.status).toBe('running');
      expect(failed?.comparison.status).toBe('generating');

      const autoSkip = await getRunQueue().getJob(autoSkipJobId(fixture.runIds[0]!, 0));
      expect(autoSkip?.opts.delay).toBe(DAY_MS);

      await retryRun(fixture.runIds[0]!, fixture.userId);
      const queued = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(queued?.runs[0]).toMatchObject({ status: 'queued', attempt: 1, error: null });

      await processRun(fixture.runIds[0]!);

      const done = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(done?.runs[0]).toMatchObject({ status: 'done', attempt: 1 });
      expect(done?.job.status).toBe('ready');
      expect(done?.runs).toHaveLength(1);

      const view = await getComparisonForViewer(fixture.comparisonId, fixture.userId);
      expect(view?.responses.filter(({ response }) => !response.isBase)).toHaveLength(1);

      const ready = (await getNotifications(fixture.userId)).filter(
        (notification) => notification.kind === 'job.ready',
      );
      expect(ready).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('settles the job when a failed run is skipped', async () => {
    process.env.MOCK_FAIL_ONCE = 'true';
    const fixture = track(await createJobFixture());

    try {
      await processRun(fixture.runIds[0]!);
      await skipRun(fixture.runIds[0]!, fixture.userId);

      const bundle = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(bundle?.runs[0]?.status).toBe('skipped');
      expect(bundle?.job.status).toBe('ready');
      expect(bundle?.comparison.status).toBe('ready');
      expect(
        (await getNotifications(fixture.userId)).filter((n) => n.kind === 'job.ready'),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('auto-skips a failed run that is left untouched', async () => {
    process.env.MOCK_FAIL_ONCE = 'true';
    const fixture = track(await createJobFixture());

    try {
      await processRun(fixture.runIds[0]!);
      const scheduled = await getRunQueue().getJob(autoSkipJobId(fixture.runIds[0]!, 0));
      expect(scheduled).toBeTruthy();
      expect(scheduled?.opts.delay).toBe(DAY_MS);

      await autoSkipRun(fixture.runIds[0]!);

      const bundle = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(bundle?.runs[0]?.status).toBe('skipped');
      expect(bundle?.job.status).toBe('ready');
      expect(
        (await getNotifications(fixture.userId)).filter((n) => n.kind === 'job.ready'),
      ).toHaveLength(1);

      await autoSkipRun(fixture.runIds[0]!);
      expect(
        (await getNotifications(fixture.userId)).filter((n) => n.kind === 'job.ready'),
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('calls the provider once when the same queued run is delivered twice', async () => {
    const fixture = track(await createJobFixture({ challengers: 2 }));

    try {
      await Promise.all([processRun(fixture.runIds[0]!), processRun(fixture.runIds[0]!)]);

      const events = await jobEventsAfter(fixture.jobId, 0);
      const calls = events.filter(
        (event) =>
          event.responseId === fixture.runIds[0] &&
          (event.payload as { status?: string }).status === 'calling',
      );
      expect(calls).toHaveLength(1);

      const bundle = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(bundle?.runs.map((run) => run.status).sort()).toEqual(['done', 'queued']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('creates no duplicate notification when completion is finalised twice', async () => {
    const fixture = track(await createJobFixture({ challengers: 2 }));

    try {
      await processRun(fixture.runIds[0]!);
      await processRun(fixture.runIds[1]!);
      await Promise.all([finalizeJob(fixture.jobId), finalizeJob(fixture.jobId)]);

      const ready = (await getNotifications(fixture.userId)).filter(
        (notification) => notification.kind === 'job.ready',
      );
      expect(ready).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });
});

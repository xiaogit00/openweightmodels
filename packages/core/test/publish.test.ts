import { afterAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import {
  closeDb,
  closeRedis,
  DomainError,
  getComparisonForViewer,
  getJobForAuthor,
  publishComparison,
  recentActivity,
} from '../src/index';
import { createJobFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; publish tests skipped');
}

afterAll(async () => {
  await closeRedis();
  await closeDb();
});

async function errorCode(action: () => Promise<unknown>) {
  try {
    await action();
    return null;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
}

async function publishedEvents(comparisonId: string) {
  return (await recentActivity(100)).filter(
    (event) => event.comparisonId === comparisonId && event.kind === 'comparison.published',
  );
}

describe.skipIf(!available)('publishing a comparison', () => {
  it('publishes a ready comparison and returns its card', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'ready',
      runStatus: 'done',
    });

    try {
      const card = await publishComparison(fixture.comparisonId, fixture.userId);
      expect(card.id).toBe(fixture.comparisonId);
      expect(card.author.handle).toBe(fixture.handle);

      const published = await getComparisonForViewer(fixture.comparisonId, null);
      expect(published?.comparison.status).toBe('published');
      expect(published?.comparison.publishedAt).toBeInstanceOf(Date);

      expect(await publishedEvents(fixture.comparisonId)).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('is idempotent when publish is called twice concurrently', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'ready',
      runStatus: 'done',
    });

    try {
      const [first, second] = await Promise.all([
        publishComparison(fixture.comparisonId, fixture.userId),
        publishComparison(fixture.comparisonId, fixture.userId),
      ]);

      expect(first.id).toBe(fixture.comparisonId);
      expect(second.id).toBe(fixture.comparisonId);
      expect(await publishedEvents(fixture.comparisonId)).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses to publish a comparison whose runs are unfinished', async () => {
    const fixture = await createJobFixture({ comparisonStatus: 'generating' });

    try {
      expect(
        await errorCode(() => publishComparison(fixture.comparisonId, fixture.userId)),
      ).toBe('not_ready');

      const view = await getComparisonForViewer(fixture.comparisonId, fixture.userId);
      expect(view?.comparison.status).toBe('generating');
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses to publish when every challenger was skipped', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'ready',
      runStatus: 'skipped',
    });

    try {
      expect(
        await errorCode(() => publishComparison(fixture.comparisonId, fixture.userId)),
      ).toBe('no_done_responses');
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps drafts and jobs invisible to everyone but the author', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'ready',
      runStatus: 'done',
    });
    const strangerId = uuidv7();

    try {
      expect(await getComparisonForViewer(fixture.comparisonId, null)).toBeNull();
      expect(await getComparisonForViewer(fixture.comparisonId, strangerId)).toBeNull();
      expect(await getJobForAuthor(fixture.jobId, null)).toBeNull();
      expect(await getJobForAuthor(fixture.jobId, strangerId)).toBeNull();

      await publishComparison(fixture.comparisonId, fixture.userId);

      expect(await getComparisonForViewer(fixture.comparisonId, null)).not.toBeNull();
      expect(await getComparisonForViewer(fixture.comparisonId, strangerId)).not.toBeNull();
      expect(await getJobForAuthor(fixture.jobId, strangerId)).toBeNull();
      expect(await getJobForAuthor(fixture.jobId, fixture.userId)).not.toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });
});

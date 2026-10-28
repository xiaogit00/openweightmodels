import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDb,
  closeRedis,
  closeRunQueue,
  createComparison,
  DomainError,
  getComparisonForViewer,
  getDb,
  getJobForAuthor,
  getNotifications,
  MAX_BASE_OUTPUT_CHARS,
  processRun,
  publishComparison,
  turns,
  UploadValidationError,
} from '../src/index';
import { createJobFixture, removeQueuedRuns, servicesAvailable } from './index';

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

async function errorCode(action: () => Promise<unknown>) {
  try {
    await action();
    return null;
  } catch (error) {
    if (error instanceof DomainError || error instanceof UploadValidationError) {
      return error.code;
    }
    return 'unexpected';
  }
}

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

  it('creates one Turn from a written prompt and a pasted Base output', async () => {
    const fixture = await createJobFixture({ challengers: 1 });
    const title = `Written ${fixture.comparisonId.slice(-8)}`;
    const prompt = 'Explain a sliding-window rate limiter in Go.';
    const reply = 'A window keeps only the timestamps inside the current span.';
    let createdResponseIds: string[] = [];

    try {
      const created = await createComparison({
        authorId: fixture.userId,
        baseOutput: reply,
        baseModelId: fixture.baseModelId,
        prompt,
        modelIds: fixture.challengerModelIds,
        title,
        categories: ['Coding'],
        effort: 1,
      });

      const turnRows = await getDb()
        .select()
        .from(turns)
        .where(eq(turns.comparisonId, created.id));
      expect(turnRows).toHaveLength(1);
      expect(turnRows[0]).toMatchObject({ position: 0, prompt });

      const draft = await getComparisonForViewer(created.id, fixture.userId);
      expect(draft?.comparison.prompt).toBe(prompt);
      const base = draft?.responses.find(({ response }) => response.isBase);
      expect(base?.response.contentMd).toBe(reply);
      expect(
        draft?.responses.every(({ response }) => response.turnId === turnRows[0]!.id),
      ).toBe(true);

      createdResponseIds =
        (await getJobForAuthor(created.jobId, fixture.userId))?.runs.map((run) => run.id) ?? [];
      for (const responseId of createdResponseIds) {
        await processRun(responseId);
      }

      const settled = await getJobForAuthor(created.jobId, fixture.userId);
      expect(settled?.job.status).toBe('ready');
      expect(settled?.runs.every((run) => run.status === 'done')).toBe(true);

      const card = await publishComparison(created.id, fixture.userId);
      expect(card.title).toBe(title);
      expect((await getComparisonForViewer(created.id, null))?.comparison.status).toBe(
        'published',
      );
    } finally {
      await removeQueuedRuns(createdResponseIds);
      await fixture.cleanup();
    }
  });

  it('defaults the title from the prompt and refuses an invalid pasted Base output', async () => {
    const fixture = await createJobFixture({ challengers: 1 });
    const required = {
      authorId: fixture.userId,
      baseModelId: fixture.baseModelId,
      modelIds: fixture.challengerModelIds,
      categories: ['Coding'],
      effort: 1,
    };
    let createdResponseIds: string[] = [];

    try {
      const created = await createComparison({
        ...required,
        baseOutput: 'A base answer.',
        prompt: 'Explain a sliding-window rate limiter in Go.',
        title: '',
      });
      expect(created.title).toBe('Explain a sliding-window rate limiter in Go.');
      createdResponseIds =
        (await getJobForAuthor(created.jobId, fixture.userId))?.runs.map((run) => run.id) ?? [];

      expect(
        await errorCode(() =>
          createComparison({
            ...required,
            baseOutput: '   ',
            prompt: 'A prompt.',
            title: 'Blank output',
          }),
        ),
      ).toBe('empty_body');
      expect(
        await errorCode(() =>
          createComparison({
            ...required,
            baseOutput: 'x'.repeat(MAX_BASE_OUTPUT_CHARS + 1),
            prompt: 'A prompt.',
            title: 'Oversized output',
          }),
        ),
      ).toBe('output_too_long');
    } finally {
      await removeQueuedRuns(createdResponseIds);
      await fixture.cleanup();
    }
  });
});

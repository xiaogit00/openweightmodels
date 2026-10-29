import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDb,
  closeRedis,
  closeRunQueue,
  createComparison,
  DomainError,
  getComparisonForViewer,
  getJobForAuthor,
  MAX_CONVERSATION_BYTES,
  processRun,
  publishComparison,
  retryRun,
  skipRun,
  UploadValidationError,
} from '../src/index';
import { createJobFixture, removeQueuedRuns, servicesAvailable } from './index';
import { fakeOpenAi, sse } from './fake-openai';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; conversation replay tests skipped');
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.MOCK_DELAY_MS = '0';
  process.env.MOCK_FAIL_ONCE = 'false';
});

afterEach(() => {
  for (const key of ['MOCK_DELAY_MS', 'MOCK_FAIL_ONCE', 'PROVIDER', 'OPENROUTER_API_KEY']) {
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

const script = [
  { prompt: 'First question', baseOutput: 'BASE ONE' },
  { prompt: 'Second question', baseOutput: 'BASE TWO' },
  { prompt: 'Third question', baseOutput: 'BASE THREE' },
];

async function errorCode(action: () => Promise<unknown>) {
  try {
    await action();
    return null;
  } catch (error) {
    if (error instanceof DomainError || error instanceof UploadValidationError) {
      return error.code;
    }
    throw error;
  }
}

async function createConversation(
  fixture: Awaited<ReturnType<typeof createJobFixture>>,
  turnScript = script,
  title = `Conversation ${fixture.comparisonId.slice(-8)}`,
) {
  return createComparison({
    authorId: fixture.userId,
    turns: turnScript,
    baseModelId: fixture.baseModelId,
    prompt: '',
    modelIds: fixture.challengerModelIds,
    title,
    categories: ['Coding'],
    effort: 1,
  });
}

describe.skipIf(!available)('multi-turn replay', () => {
  it('creates every Turn once and one Response per Model per Turn', async () => {
    const fixture = await createJobFixture({ challengers: 2 });
    let runIds: string[] = [];

    try {
      const created = await createConversation(fixture);

      const conversation = await getComparisonForViewer(created.id, fixture.userId);
      expect(conversation?.turns.map((turn) => turn.prompt)).toEqual(
        script.map((turn) => turn.prompt),
      );
      const baseRows = conversation?.responses.filter(({ response }) => response.isBase) ?? [];
      expect(baseRows).toHaveLength(3);
      expect(baseRows.map(({ response }) => response.contentMd).sort()).toEqual(
        script.map((turn) => turn.baseOutput).sort(),
      );
      expect(conversation?.comparison.prompt).toBe('First question');

      const bundle = await getJobForAuthor(created.jobId, fixture.userId);
      runIds = bundle?.runs.map((run) => run.id) ?? [];
      expect(bundle?.runs).toHaveLength(6);
      expect(bundle?.runs.map((run) => run.turnNumber)).toEqual([1, 1, 2, 2, 3, 3]);
      expect(bundle?.runs.every((run) => run.turnCount === 3)).toBe(true);
      expect(bundle?.runs.every((run) => run.status === 'queued')).toBe(true);
    } finally {
      await removeQueuedRuns(runIds);
      await fixture.cleanup();
    }
  });

  it('sends each Challenger its own earlier replies and never the Base replies', async () => {
    const providerServer = await fakeOpenAi((request) => ({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(
        JSON.stringify({
          choices: [
            {
              delta: {
                content: `answer from ${String(request.body.model)}`,
              },
            },
          ],
        }),
        JSON.stringify({ usage: { completion_tokens: 3 } }),
        '[DONE]',
      ),
    }));

    process.env.PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-key';

    const fixture = await createJobFixture({
      challengers: 2,
      provider: 'openrouter',
      apiBase: providerServer.baseUrl,
      challengerApiModelIds: ['vendor/alpha', 'vendor/beta'],
    });
    let runIds: string[] = [];

    try {
      const created = await createConversation(fixture, script.slice(0, 2));
      const bundle = await getJobForAuthor(created.jobId, fixture.userId);
      runIds = bundle?.runs.map((run) => run.id) ?? [];
      for (const run of bundle!.runs) {
        await processRun(run.id);
      }

      const messagesFor = (model: string) =>
        providerServer.requests
          .filter((request) => request.body.model === model)
          .map((request) => request.body.messages);

      expect(messagesFor('vendor/alpha')).toEqual([
        [{ role: 'user', content: 'First question' }],
        [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'answer from vendor/alpha' },
          { role: 'user', content: 'Second question' },
        ],
      ]);
      expect(messagesFor('vendor/beta')).toEqual([
        [{ role: 'user', content: 'First question' }],
        [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'answer from vendor/beta' },
          { role: 'user', content: 'Second question' },
        ],
      ]);
      expect(JSON.stringify(providerServer.requests)).not.toContain('BASE ONE');
      expect(JSON.stringify(providerServer.requests)).not.toContain('BASE TWO');
    } finally {
      await removeQueuedRuns(runIds);
      await fixture.cleanup();
      await providerServer.close();
    }
  });

  it('fails only the Turn that failed, then retries from it and finishes the Replay', async () => {
    const fixture = await createJobFixture({ challengers: 1 });
    let runIds: string[] = [];

    try {
      const created = await createConversation(fixture);
      const bundle = await getJobForAuthor(created.jobId, fixture.userId);
      runIds = bundle?.runs.map((run) => run.id) ?? [];
      const [first, second, third] = runIds;

      await processRun(first!);
      process.env.MOCK_FAIL_ONCE = 'true';
      await processRun(second!);

      const failed = await getJobForAuthor(created.jobId, fixture.userId);
      expect(failed?.runs.map((run) => run.status)).toEqual(['done', 'failed', 'queued']);
      expect(failed?.job.status).toBe('running');
      expect(failed?.comparison.status).toBe('generating');
      expect(await errorCode(() => publishComparison(created.id, fixture.userId))).toBe(
        'not_ready',
      );

      process.env.MOCK_FAIL_ONCE = 'false';
      await retryRun(second!, fixture.userId);
      await processRun(second!);
      await processRun(third!);

      const settled = await getJobForAuthor(created.jobId, fixture.userId);
      expect(settled?.runs.map((run) => run.status)).toEqual(['done', 'done', 'done']);
      expect(settled?.job.status).toBe('ready');
      expect(settled?.comparison.status).toBe('ready');

      const published = await publishComparison(created.id, fixture.userId);
      expect(published.title).toBe(created.title);
    } finally {
      await removeQueuedRuns(runIds);
      await fixture.cleanup();
    }
  });

  it('cascades Skip to every later Turn and labels the stopped Replay on the Comparison', async () => {
    const fixture = await createJobFixture({ challengers: 1 });
    let runIds: string[] = [];

    try {
      const created = await createConversation(fixture);
      const bundle = await getJobForAuthor(created.jobId, fixture.userId);
      runIds = bundle?.runs.map((run) => run.id) ?? [];
      const [first, second] = runIds;

      await processRun(first!);
      process.env.MOCK_FAIL_ONCE = 'true';
      await processRun(second!);
      process.env.MOCK_FAIL_ONCE = 'false';
      await skipRun(second!, fixture.userId);

      const stopped = await getJobForAuthor(created.jobId, fixture.userId);
      expect(stopped?.runs.map((run) => run.status)).toEqual(['done', 'skipped', 'skipped']);
      expect(stopped?.job.status).toBe('ready');
      expect(stopped?.comparison.status).toBe('ready');

      await publishComparison(created.id, fixture.userId);
      const published = await getComparisonForViewer(created.id, null);
      const challengerRows = published?.responses.filter(({ response }) => !response.isBase);
      expect(challengerRows?.map(({ response }) => response.status)).toEqual([
        'done',
        'skipped',
        'skipped',
      ]);
    } finally {
      await removeQueuedRuns(runIds);
      await fixture.cleanup();
    }
  });

  it('refuses more than six Turns and more than 100,000 replayed characters', async () => {
    const fixture = await createJobFixture({ challengers: 1 });

    try {
      expect(
        await errorCode(() =>
          createConversation(
            fixture,
            Array.from({ length: 7 }, (_, index) => ({
              prompt: `Question ${index}`,
              baseOutput: `Answer ${index}`,
            })),
          ),
        ),
      ).toBe('too_many_turns');

      expect(
        await errorCode(() =>
          createConversation(fixture, [
            { prompt: 'A'.repeat(10_000), baseOutput: 'B'.repeat(90_001) },
          ]),
        ),
      ).toBe('conversation_too_long');

      expect(
        await errorCode(() =>
          createComparison({
            authorId: fixture.userId,
            fileName: 'conversation.md',
            fileText: 'x'.repeat(MAX_CONVERSATION_BYTES + 1),
            baseModelId: fixture.baseModelId,
            prompt: 'A prompt.',
            modelIds: fixture.challengerModelIds,
            title: 'Too large',
            categories: ['Coding'],
            effort: 1,
          }),
        ),
      ).toBe('conversation_too_large');
    } finally {
      await fixture.cleanup();
    }
  });
});

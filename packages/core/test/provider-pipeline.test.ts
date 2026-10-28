import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  autoSkipJobId,
  closeDb,
  closeRedis,
  closeRunQueue,
  getComparisonForViewer,
  getDb,
  getJobForAuthor,
  getNotifications,
  getRunQueue,
  processRun,
  responses,
  retryRun,
} from '../src/index';
import { createJobFixture, removeQueuedRuns, servicesAvailable } from './index';
import { fakeOpenAi, sse } from './fake-openai';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; provider pipeline tests skipped');
}

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of ['PROVIDER', 'OPENROUTER_API_KEY']) {
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

async function storedRuns(jobId: string) {
  return getDb().select().from(responses).where(eq(responses.jobId, jobId));
}

describe.skipIf(!available)('real provider through the Job pipeline', () => {
  it('persists streamed content, tokens, latency and cost for every Challenger', async () => {
    const providerServer = await fakeOpenAi(() => ({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(
        JSON.stringify({ choices: [{ delta: { content: 'Streamed ' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'answer' } }] }),
        JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11, cost: 0.00123 },
        }),
        '[DONE]',
      ),
    }));

    process.env.PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-key';

    const fixture = await createJobFixture({
      challengers: 2,
      provider: 'openrouter',
      apiBase: providerServer.baseUrl,
      apiModelId: 'vendor/model-under-test',
    });

    try {
      for (const responseId of fixture.runIds) {
        await processRun(responseId);
      }

      const bundle = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(bundle?.job.status).toBe('ready');
      expect(bundle?.comparison.status).toBe('ready');
      expect(bundle?.runs).toHaveLength(2);
      for (const run of bundle!.runs) {
        expect(run).toMatchObject({ status: 'done', tokens: 2, attempt: 0 });
        expect(run.latencyMs).toBeGreaterThanOrEqual(0);
      }

      // Cost is stored on the Response but deliberately not exposed in v1.
      const rows = await storedRuns(fixture.jobId);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(Number(row.costUsd)).toBeCloseTo(0.00123, 6);
      }

      const view = await getComparisonForViewer(fixture.comparisonId, fixture.userId);
      const challengers = view!.responses.filter(({ response }) => !response.isBase);
      expect(challengers).toHaveLength(2);
      for (const { response } of challengers) {
        expect(response.contentMd).toBe('Streamed answer');
      }

      // Every Challenger answers the same Turn. With one Turn the message array
      // holds only that user message — no Base replies, no assistant history.
      expect(providerServer.requests).toHaveLength(2);
      expect(providerServer.requests.map((request) => request.body.messages)).toEqual([
        [{ role: 'user', content: 'Explain a sliding-window rate limiter with Go code.' }],
        [{ role: 'user', content: 'Explain a sliding-window rate limiter with Go code.' }],
      ]);
      // The registry's api_model_id is what the provider is asked for.
      expect(providerServer.requests.map((request) => request.body.model)).toEqual([
        'vendor/model-under-test',
        'vendor/model-under-test',
      ]);

      const ready = (await getNotifications(fixture.userId)).filter(
        (notification) => notification.kind === 'job.ready',
      );
      expect(ready).toHaveLength(1);
    } finally {
      await removeQueuedRuns(fixture.runIds);
      await fixture.cleanup();
      await providerServer.close();
    }
  });

  it('turns a provider error into a failed Run that retries to success', async () => {
    let fail = true;
    const providerServer = await fakeOpenAi(() =>
      fail
        ? {
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { message: 'upstream exploded for test-key' },
            }),
          }
        : {
            status: 200,
            contentType: 'text/event-stream',
            body: sse(
              JSON.stringify({ choices: [{ delta: { content: 'Recovered' } }] }),
              JSON.stringify({ usage: { completion_tokens: 1, cost: 0.0004 } }),
              '[DONE]',
            ),
          },
    );

    process.env.PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-key';

    const fixture = await createJobFixture({
      challengers: 1,
      provider: 'openrouter',
      apiBase: providerServer.baseUrl,
    });
    const responseId = fixture.runIds[0]!;

    try {
      await processRun(responseId);

      let bundle = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(bundle?.runs[0]).toMatchObject({ status: 'failed', attempt: 0 });
      expect(bundle?.runs[0]?.error).toContain('provider returned 500');
      expect(bundle?.runs[0]?.error).toContain('upstream exploded');
      expect(bundle?.runs[0]?.error).not.toContain('test-key');
      expect(bundle?.comparison.status).toBe('generating');
      expect(await getRunQueue().getJob(autoSkipJobId(responseId, 0))).toBeTruthy();

      fail = false;
      await retryRun(responseId, fixture.userId);
      await processRun(responseId);

      bundle = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(bundle?.runs[0]).toMatchObject({ status: 'done', attempt: 1 });
      expect(bundle?.job.status).toBe('ready');
      expect(bundle?.comparison.status).toBe('ready');

      const [row] = await storedRuns(fixture.jobId);
      expect(Number(row?.costUsd)).toBeCloseTo(0.0004, 6);
    } finally {
      await removeQueuedRuns(fixture.runIds);
      await fixture.cleanup();
      await providerServer.close();
    }
  });
});

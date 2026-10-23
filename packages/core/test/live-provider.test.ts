import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  closeDb,
  closeRedis,
  closeRunQueue,
  getDb,
  getJobForAuthor,
  jobEvents,
  processRun,
  responses,
} from '../src/index';
import { createJobFixture, removeQueuedRuns, servicesAvailable } from './index';

const available = await servicesAvailable();
const liveRequested = process.env.npm_lifecycle_event === 'test:live';
const liveKey = process.env.OPENROUTER_API_KEY?.trim();

// `pnpm test:live` must fail loudly rather than skip green: a smoke command
// that verifies nothing is worse than no smoke command.
if (liveRequested && !liveKey) {
  throw new Error('pnpm test:live requires OPENROUTER_API_KEY (see README).');
}
if (liveRequested && !available) {
  throw new Error('pnpm test:live requires Postgres and Redis; start the local stack.');
}
if (!liveRequested) {
  console.warn('[tests] live provider smoke skipped; run `pnpm test:live` with OPENROUTER_API_KEY set');
}

const MODEL = process.env.LIVE_PROVIDER_MODEL?.trim() || 'deepseek/deepseek-chat';

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of ['PROVIDER']) {
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

describe.skipIf(!available || !liveRequested)('live OpenRouter generation', () => {
  it(
    'generates through the Job pipeline and stores tokens, latency and cost',
    async () => {
      process.env.PROVIDER = 'openrouter';

      const fixture = await createJobFixture({
        challengers: 1,
        provider: 'openrouter',
        apiModelId: MODEL,
        titlePrefix: 'Live provider smoke',
      });
      const responseId = fixture.runIds[0]!;

      try {
        await processRun(responseId);

        const bundle = await getJobForAuthor(fixture.jobId, fixture.userId);
        const [stored] = await getDb()
          .select()
          .from(responses)
          .where(eq(responses.id, responseId))
          .limit(1);

        const events = await getDb()
          .select()
          .from(jobEvents)
          .where(eq(jobEvents.jobId, fixture.jobId));
        const streamed = events.filter(
          (event) =>
            event.kind === 'response.status' &&
            (event.payload as { status?: string }).status === 'streaming',
        );

        console.log(
          `[live] ${MODEL}: status=${stored?.status} tokens=${stored?.tokens} ` +
            `latency=${stored?.latencyMs}ms cost=$${stored?.costUsd ?? 'null'} ` +
            `chars=${stored?.contentMd.length ?? 0} streamingEvents=${streamed.length}`,
        );

        expect(stored?.error).toBeNull();
        expect(stored?.status).toBe('done');
        expect(stored?.contentMd.trim().length).toBeGreaterThan(0);
        expect(stored?.tokens).toBeGreaterThan(0);
        expect(stored?.latencyMs).toBeGreaterThan(0);
        // OpenRouter reports cost in the usage block when asked.
        expect(stored?.costUsd).not.toBeNull();
        expect(Number(stored?.costUsd)).toBeGreaterThan(0);
        // Token callbacks reached the Job event log, so the answer streamed
        // rather than arriving in one buffered response.
        expect(streamed.length).toBeGreaterThan(0);

        expect(bundle?.job.status).toBe('ready');
        expect(bundle?.comparison.status).toBe('ready');
        expect(bundle?.runs[0]).toMatchObject({ status: 'done', attempt: 0 });
      } finally {
        await removeQueuedRuns(fixture.runIds);
        await fixture.cleanup();
      }
    },
    // A real provider call may stream for up to the adapter's 120s timeout.
    180_000,
  );
});

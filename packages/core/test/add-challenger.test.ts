import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  addModelToComparison,
  closeDb,
  closeRedis,
  DomainError,
  getComparisonForViewer,
  getComparisonRow,
  getCardById,
  getDb,
  models,
  processRun,
  retryRun,
  skipRun,
} from '../src/index';
import { createJobFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; add-challenger tests skipped');
}

const originalEnv = { ...process.env };
const extraModelIds: string[] = [];

afterEach(async () => {
  for (const key of ['MOCK_DELAY_MS', 'MOCK_FAIL_ONCE', 'MAX_CHALLENGERS']) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const db = getDb();
  for (const id of extraModelIds.splice(0)) {
    await db.delete(models).where(eq(models.id, id));
  }
});

afterAll(async () => {
  await closeRedis();
  await closeDb();
});

async function createExtraModel(options: { enabled?: boolean } = {}) {
  const tag = uuidv7().replace(/-/g, '').slice(-10);
  const [row] = await getDb()
    .insert(models)
    .values({
      id: uuidv7(),
      slug: `fixture-extra-${tag}`,
      displayName: `Fixture Extra ${tag}`,
      monogram: 'FX',
      provider: 'mock',
      enabled: options.enabled ?? true,
    })
    .returning();
  if (!row) throw new Error('extra model was not inserted');
  extraModelIds.push(row.id);
  return row;
}

async function errorCode(action: () => Promise<unknown>) {
  try {
    await action();
    return null;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
}

function challengers(view: Awaited<ReturnType<typeof getComparisonForViewer>>) {
  return view?.responses.filter(({ response }) => !response.isBase) ?? [];
}

describe.skipIf(!available)('adding a Challenger to a published Comparison', () => {
  it('keeps the pending tab author-only and publishes it atomically when done', async () => {
    process.env.MOCK_DELAY_MS = '0';
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const extra = await createExtraModel();

    try {
      const before = await getComparisonForViewer(fixture.comparisonId, fixture.userId);
      const beforeRow = await getComparisonRow(fixture.comparisonId);
      const baseBefore = before?.responses.find(({ response }) => response.isBase);
      const existingBefore = challengers(before)[0];

      const { jobId, responseId } = await addModelToComparison(
        fixture.comparisonId,
        extra.id,
        fixture.userId,
      );
      expect(jobId).toBeTruthy();
      expect(responseId).toBeTruthy();

      // The author sees the queued Challenger immediately.
      const authorView = await getComparisonForViewer(
        fixture.comparisonId,
        fixture.userId,
      );
      const pending = authorView?.responses.find(
        ({ response }) => response.id === responseId,
      );
      expect(pending?.response).toMatchObject({
        status: 'queued',
        isBase: false,
        modelId: extra.id,
      });
      expect(pending?.model.id).toBe(extra.id);

      // Readers see neither the pending tab nor a changed card yet.
      const publicPending = await getComparisonForViewer(fixture.comparisonId, null);
      expect(challengers(publicPending)).toHaveLength(1);
      expect(
        publicPending?.responses.some(({ response }) => response.id === responseId),
      ).toBe(false);
      const pendingCard = await getCardById(fixture.comparisonId);
      expect(pendingCard?.models.map((model) => model.slug)).not.toContain(extra.slug);

      // Nothing that was already reviewed moved.
      const afterRow = await getComparisonRow(fixture.comparisonId);
      expect(afterRow?.title).toBe(beforeRow?.title);
      expect(afterRow?.prompt).toBe(beforeRow?.prompt);
      expect(afterRow?.baseModelId).toBe(beforeRow?.baseModelId);
      expect(afterRow?.status).toBe('published');
      const afterResponse = await getComparisonForViewer(
        fixture.comparisonId,
        fixture.userId,
      );
      expect(
        afterResponse?.responses.find(({ response }) => response.id === baseBefore?.response.id)
          ?.response.contentMd,
      ).toBe(baseBefore?.response.contentMd);
      expect(
        afterResponse?.responses.find(
          ({ response }) => response.id === existingBefore?.response.id,
        )?.response.contentMd,
      ).toBe(existingBefore?.response.contentMd);

      await processRun(responseId);

      // Completion is the publication point: both readers and the card see it.
      const publicDone = await getComparisonForViewer(fixture.comparisonId, null);
      const added = challengers(publicDone).find(
        ({ response }) => response.id === responseId,
      );
      expect(added?.response.status).toBe('done');
      expect(added?.response.contentMd.length).toBeGreaterThan(0);
      expect(challengers(publicDone)).toHaveLength(2);

      const doneCard = await getCardById(fixture.comparisonId);
      expect(doneCard?.models.map((model) => model.slug)).toContain(extra.slug);
      expect((await getComparisonRow(fixture.comparisonId))?.status).toBe('published');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects the Base model, duplicates, disabled models and a fifth Challenger', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const disabled = await createExtraModel({ enabled: false });

    try {
      expect(
        await errorCode(() =>
          addModelToComparison(fixture.comparisonId, fixture.baseModelId, fixture.userId),
        ),
      ).toBe('base_model');

      expect(
        await errorCode(() =>
          addModelToComparison(
            fixture.comparisonId,
            fixture.challengerModelIds[0]!,
            fixture.userId,
          ),
        ),
      ).toBe('model_exists');

      expect(
        await errorCode(() =>
          addModelToComparison(fixture.comparisonId, disabled.id, fixture.userId),
        ),
      ).toBe('invalid_model');

      process.env.MAX_CHALLENGERS = '1';
      const extra = await createExtraModel();
      expect(
        await errorCode(() =>
          addModelToComparison(fixture.comparisonId, extra.id, fixture.userId),
        ),
      ).toBe('too_many_challengers');
      expect(challengers(await getComparisonForViewer(fixture.comparisonId, fixture.userId)))
        .toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('publishes a retried add once it succeeds, never before', async () => {
    process.env.MOCK_DELAY_MS = '0';
    process.env.MOCK_FAIL_ONCE = 'true';
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const extra = await createExtraModel();

    try {
      const { responseId } = await addModelToComparison(
        fixture.comparisonId,
        extra.id,
        fixture.userId,
      );
      await processRun(responseId);

      const failed = await getComparisonForViewer(fixture.comparisonId, fixture.userId);
      const failedRun = challengers(failed).find(
        ({ response }) => response.id === responseId,
      );
      expect(failedRun?.response.status).toBe('failed');
      expect(failedRun?.response.error).toContain('API timeout');
      expect(challengers(await getComparisonForViewer(fixture.comparisonId, null))).toHaveLength(1);

      await retryRun(responseId, fixture.userId);
      await processRun(responseId);

      const done = challengers(
        await getComparisonForViewer(fixture.comparisonId, null),
      ).find(({ response }) => response.id === responseId);
      expect(done?.response.status).toBe('done');
      expect(challengers(await getComparisonForViewer(fixture.comparisonId, null))).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps a dismissed failed add out of the public view and frees its slot', async () => {
    process.env.MOCK_DELAY_MS = '0';
    process.env.MOCK_FAIL_ONCE = 'true';
    process.env.MAX_CHALLENGERS = '2';
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const extra = await createExtraModel();
    const replacement = await createExtraModel();

    try {
      const { responseId } = await addModelToComparison(
        fixture.comparisonId,
        extra.id,
        fixture.userId,
      );
      await processRun(responseId);
      await skipRun(responseId, fixture.userId);

      const author = challengers(
        await getComparisonForViewer(fixture.comparisonId, fixture.userId),
      );
      expect(
        author.find(({ response }) => response.id === responseId)?.response.status,
      ).toBe('skipped');
      expect(
        challengers(await getComparisonForViewer(fixture.comparisonId, null)),
      ).toHaveLength(1);
      const card = await getCardById(fixture.comparisonId);
      expect(card?.models.map((model) => model.slug)).not.toContain(extra.slug);
      expect((await getComparisonRow(fixture.comparisonId))?.status).toBe('published');

      // The dismissed Run no longer occupies one of the two Challenger slots.
      const second = await addModelToComparison(
        fixture.comparisonId,
        replacement.id,
        fixture.userId,
      );
      expect(second.responseId).toBeTruthy();
    } finally {
      await fixture.cleanup();
    }
  });
});

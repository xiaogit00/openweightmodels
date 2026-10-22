import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  activityAfter,
  closeDb,
  closeRedis,
  createComment,
  DomainError,
  getAdminOverview,
  getBoardFacets,
  getCardById,
  getComparisonForViewer,
  getDb,
  getJobForAuthor,
  getModels,
  listComparisons,
  models,
  processRun,
  restoreComparison,
  setModelEnabled,
  takeDownComparison,
} from '../src/index';
import { createJobFixture, createUserFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; admin tests skipped');
}

const extraModelIds: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const id of extraModelIds.splice(0)) {
    await db.delete(models).where(eq(models.id, id));
  }
});

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

async function createModel(enabled = true) {
  const tag = uuidv7().replace(/-/g, '').slice(-10);
  const [row] = await getDb()
    .insert(models)
    .values({
      id: uuidv7(),
      slug: `fixture-admin-${tag}`,
      displayName: `Fixture Admin ${tag}`,
      monogram: 'FA',
      provider: 'mock',
      enabled,
    })
    .returning();
  if (!row) throw new Error('admin fixture model was not inserted');
  extraModelIds.push(row.id);
  return row;
}

describe.skipIf(!available)('admin model registry', () => {
  it('lets only an admin disable and re-enable a Model, recording each action', async () => {
    const admin = await createUserFixture({ role: 'admin' });
    const member = await createUserFixture();
    const model = await createModel();

    try {
      expect(await errorCode(() => setModelEnabled(member.id, model.id, false))).toBe(
        'not_found',
      );
      expect((await getModels()).some((row) => row.id === model.id)).toBe(true);

      await setModelEnabled(admin.id, model.id, false);

      expect((await getModels()).some((row) => row.id === model.id)).toBe(false);
      const disabled = (await getAdminOverview(admin.id)).models.find(
        (row) => row.id === model.id,
      );
      expect(disabled?.enabled).toBe(false);

      await setModelEnabled(admin.id, model.id, true);
      expect((await getModels()).some((row) => row.id === model.id)).toBe(true);
      const actions = (await getAdminOverview(admin.id)).recentActions.filter(
        (action) => action.targetId === model.id,
      );
      expect(actions).toEqual([
        expect.objectContaining({
          action: 'model.enabled',
          actorHandle: admin.handle,
          targetType: 'model',
          targetLabel: model.displayName,
        }),
        expect.objectContaining({
          action: 'model.disabled',
          actorHandle: admin.handle,
          targetType: 'model',
          targetLabel: model.displayName,
        }),
      ]);
    } finally {
      await admin.cleanup();
      await member.cleanup();
    }
  });

  it('fails a queued Run instead of calling a disabled Model', async () => {
    const fixture = await createJobFixture({ challengers: 1, runStatus: 'queued' });
    const admin = await createUserFixture({ role: 'admin' });

    try {
      await setModelEnabled(admin.id, fixture.challengerModelIds[0]!, false);
      await processRun(fixture.runIds[0]!);

      const job = await getJobForAuthor(fixture.jobId, fixture.userId);
      expect(job?.runs[0]).toMatchObject({
        status: 'failed',
        error: 'Model disabled',
      });
    } finally {
      await fixture.cleanup();
      await admin.cleanup();
    }
  });
});

describe.skipIf(!available)('comparison takedowns', () => {
  it('hides a published Comparison from readers and the Board, then restores it', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const admin = await createUserFixture({ role: 'admin' });
    const member = await createUserFixture();

    try {
      expect(
        await errorCode(() =>
          takeDownComparison(member.id, fixture.comparisonId, 'Not allowed'),
        ),
      ).toBe('not_found');
      expect((await getComparisonForViewer(fixture.comparisonId, null))?.comparison.id).toBe(
        fixture.comparisonId,
      );

      const facetsBefore = await getBoardFacets();
      const boardBefore = await listComparisons({ limit: 100 });
      expect(boardBefore.items.some((card) => card.id === fixture.comparisonId)).toBe(true);

      await createComment({
        userId: fixture.userId,
        comparisonId: fixture.comparisonId,
        body: 'A ticker line that must not outlive the takedown.',
      });
      expect(
        (await activityAfter(0, 500)).some(
          (event) =>
            event.comparisonId === fixture.comparisonId && event.summary !== '',
        ),
      ).toBe(true);

      await takeDownComparison(
        admin.id,
        fixture.comparisonId,
        'Prompt contains private data',
      );

      expect(await getComparisonForViewer(fixture.comparisonId, null)).toBeNull();
      expect(
        await getComparisonForViewer(fixture.comparisonId, fixture.userId),
      ).toBeNull();
      expect(
        await getComparisonForViewer(fixture.comparisonId, admin.id, true),
      ).not.toBeNull();
      expect(await getCardById(fixture.comparisonId)).toBeNull();

      const boardAfter = await listComparisons({ limit: 100 });
      expect(boardAfter.items.some((card) => card.id === fixture.comparisonId)).toBe(false);
      expect(boardAfter.total).toBe(boardBefore.total - 1);
      expect((await getBoardFacets()).total).toBe(facetsBefore.total - 1);

      const hidden = (await getAdminOverview(admin.id)).hiddenComparisons.find(
        (row) => row.id === fixture.comparisonId,
      );
      expect(hidden).toMatchObject({
        title: expect.any(String),
        takedownReason: 'Prompt contains private data',
        takedownByHandle: admin.handle,
      });

      const audit = (await getAdminOverview(admin.id)).recentActions.find(
        (row) =>
          row.targetId === fixture.comparisonId && row.action === 'comparison.takedown',
      );
      expect(audit).toMatchObject({
        actorHandle: admin.handle,
        targetType: 'comparison',
        reason: 'Prompt contains private data',
      });

      const takedownEvent = (await activityAfter(0, 500)).find(
        (event) =>
          event.comparisonId === fixture.comparisonId &&
          event.kind === 'comparison.takedown',
      );
      expect(takedownEvent?.payload).toMatchObject({
        comparisonId: fixture.comparisonId,
      });
      expect(takedownEvent?.summary).toBe('');
      expect(takedownEvent?.actorId).toBeNull();
      expect(
        (await activityAfter(0, 500)).filter(
          (event) =>
            event.comparisonId === fixture.comparisonId && event.summary !== '',
        ),
      ).toEqual([]);

      expect(await errorCode(() => restoreComparison(member.id, fixture.comparisonId))).toBe(
        'not_found',
      );
      await restoreComparison(admin.id, fixture.comparisonId);

      expect((await getComparisonForViewer(fixture.comparisonId, null))?.comparison.id).toBe(
        fixture.comparisonId,
      );
      expect(await getCardById(fixture.comparisonId)).not.toBeNull();
      expect(
        (await getAdminOverview(admin.id)).hiddenComparisons.some(
          (row) => row.id === fixture.comparisonId,
        ),
      ).toBe(false);

      const restoreEvent = (await activityAfter(0, 500)).find(
        (event) =>
          event.comparisonId === fixture.comparisonId &&
          event.kind === 'comparison.restored',
      );
      expect(restoreEvent?.payload).toMatchObject({
        card: { id: fixture.comparisonId },
      });
    } finally {
      await fixture.cleanup();
      await admin.cleanup();
      await member.cleanup();
    }
  });
});

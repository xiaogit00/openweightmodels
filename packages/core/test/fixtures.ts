import { eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../src/db/client';
import { comparisons, jobs, models, responses, users } from '../src/db/schema';
import type { ComparisonStatus, ResponseStatus } from '../src/domain/types';

export type JobFixtureOptions = {
  /** Number of Challenger Runs. Defaults to 1. */
  challengers?: number;
  comparisonStatus?: ComparisonStatus;
  runStatus?: ResponseStatus;
  attempt?: number;
};

/**
 * Creates one Comparison with one Job and its Challenger Runs, using Models
 * owned by the fixture so tests never depend on the dev seed.
 */
export async function createJobFixture(options: JobFixtureOptions = {}) {
  const db = getDb();
  const challengers = options.challengers ?? 1;
  const tag = uuidv7().replace(/-/g, '').slice(-10);

  const modelRows = await db
    .insert(models)
    .values([
      {
        id: uuidv7(),
        slug: `fixture-base-${tag}`,
        displayName: `Fixture Base ${tag}`,
        monogram: 'FB',
        provider: 'mock',
      },
      ...Array.from({ length: challengers }, (_, index) => ({
        id: uuidv7(),
        slug: `fixture-challenger-${index}-${tag}`,
        displayName: `Fixture Challenger ${index + 1} ${tag}`,
        monogram: 'FC',
        provider: 'mock',
      })),
    ])
    .returning();

  const baseModel = modelRows.find((row) => row.slug === `fixture-base-${tag}`);
  const challengerModels = modelRows
    .filter((row) => row.slug !== `fixture-base-${tag}`)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (!baseModel) throw new Error('fixture base model was not inserted');
  const userId = uuidv7();
  const comparisonId = uuidv7();
  const jobId = uuidv7();
  const handle = `fixture-${tag}`;

  await db.insert(users).values({ id: userId, handle });
  await db.insert(comparisons).values({
    id: comparisonId,
    authorId: userId,
    title: `Fixture comparison ${tag}`,
    prompt: 'Explain a sliding-window rate limiter with Go code.',
    categories: ['backend'],
    effort: 1,
    baseModelId: baseModel.id,
    status: options.comparisonStatus ?? 'generating',
  });
  await db.insert(jobs).values({ id: jobId, comparisonId, status: 'scheduled' });
  await db.insert(responses).values({
    id: uuidv7(),
    comparisonId,
    modelId: baseModel.id,
    isBase: true,
    contentMd: 'A base answer, frozen at scheduling time.',
    tokens: 12,
    latencyMs: 0,
    status: 'done',
    finishedAt: new Date(),
  });

  const runRows = await db
    .insert(responses)
    .values(
      challengerModels.map((model) => ({
        id: uuidv7(),
        comparisonId,
        jobId,
        modelId: model.id,
        isBase: false,
        status: options.runStatus ?? ('queued' as const),
        attempt: options.attempt ?? 0,
        ...(options.runStatus === 'failed'
          ? { error: 'API timeout', finishedAt: new Date() }
          : {}),
      })),
    )
    .returning();

  return {
    userId,
    handle,
    comparisonId,
    jobId,
    baseModelId: baseModel.id,
    challengerModelIds: challengerModels.map((model) => model.id),
    runIds: runRows.map((row) => row.id),
    async cleanup() {
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(models).where(inArray(models.id, modelRows.map((row) => row.id)));
    },
  };
}

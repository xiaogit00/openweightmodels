import { eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../src/db/client';
import { comparisons, jobs, models, responses, turns, users } from '../src/db/schema';
import type { Category, ComparisonStatus, ResponseStatus } from '../src/domain/types';

export type FixtureOptions = {
  /** Number of Challenger Runs. Defaults to 1. */
  challengers?: number;
  comparisonStatus?: ComparisonStatus;
  runStatus?: ResponseStatus;
  attempt?: number;
  /** Shared title prefix so a list query can find only this fixture's rows. */
  titlePrefix?: string;
  publishedAt?: Date;
  createdAt?: Date;
  commentCount?: number;
  annotationCount?: number;
  categories?: Category[];
  effort?: 1 | 2 | 3;
  /** Provider registered on the fixture Models. Defaults to the mock provider. */
  provider?: string;
  /** Optional OpenAI-compatible endpoint used by integration tests. */
  apiBase?: string | null;
  /** Provider model identifier the adapter should send. Defaults to null. */
  apiModelId?: string | null;
  /** Per-Challenger provider identifiers, in creation order. */
  challengerApiModelIds?: Array<string | null>;
  /**
   * Attach this Comparison to an existing account instead of creating a
   * throwaway author. The caller owns that account's cleanup.
   */
  authorId?: string;
  authorHandle?: string;
};

/**
 * Creates a signed-in user that owns nothing, for permission and voting tests.
 */
export async function createUserFixture(
  options: { role?: 'user' | 'admin'; email?: string | null; handle?: string | null } = {},
) {
  const db = getDb();
  const tag = uuidv7().replace(/-/g, '').slice(-10);
  const [user] = await db
    .insert(users)
    .values({
      id: uuidv7(),
      handle: options.handle === undefined ? `reader-${tag}` : options.handle,
      email: options.email ?? null,
      role: options.role ?? 'user',
    })
    .returning();
  if (!user) throw new Error('fixture user was not inserted');

  return {
    id: user.id,
    handle: user.handle,
    email: user.email,
    async cleanup() {
      await db.delete(users).where(eq(users.id, user.id));
    },
  };
}

/**
 * Creates one Comparison with one Job and its Challenger Runs, using Models
 * owned by the fixture so tests never depend on the dev seed.
 */
export async function createJobFixture(options: FixtureOptions = {}) {
  const db = getDb();
  const challengers = options.challengers ?? 1;
  const tag = uuidv7().replace(/-/g, '').slice(-10);

  const modelRow = (
    slug: string,
    displayName: string,
    monogram: string,
    apiModelId: string | null = options.apiModelId ?? null,
  ) => ({
    id: uuidv7(),
    slug,
    displayName,
    monogram,
    provider: options.provider ?? 'mock',
    apiBase: options.apiBase ?? null,
    apiModelId,
  });

  const modelRows = await db
    .insert(models)
    .values([
      modelRow(`fixture-base-${tag}`, `Fixture Base ${tag}`, 'FB'),
      ...Array.from({ length: challengers }, (_, index) =>
        modelRow(
          `fixture-challenger-${index}-${tag}`,
          `Fixture Challenger ${index + 1} ${tag}`,
          'FC',
          options.challengerApiModelIds?.[index] ?? options.apiModelId ?? null,
        ),
      ),
    ])
    .returning();

  const baseModel = modelRows.find((row) => row.slug === `fixture-base-${tag}`);
  const challengerModels = modelRows
    .filter((row) => row.slug !== `fixture-base-${tag}`)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (!baseModel) throw new Error('fixture base model was not inserted');
  const userId = options.authorId ?? uuidv7();
  const comparisonId = uuidv7();
  const jobId = uuidv7();
  const turnId = uuidv7();
  const handle = options.authorHandle ?? `fixture-${tag}`;

  if (!options.authorId) {
    await db.insert(users).values({ id: userId, handle });
  }
  const status = options.comparisonStatus ?? 'generating';
  await db.insert(comparisons).values({
    id: comparisonId,
    authorId: userId,
    title: `${options.titlePrefix ?? 'Fixture comparison'} ${tag}`,
    prompt: 'Explain a sliding-window rate limiter with Go code.',
    categories: options.categories ?? ['Coding'],
    effort: options.effort ?? 1,
    baseModelId: baseModel.id,
    status,
    createdAt: options.createdAt,
    publishedAt:
      options.publishedAt ?? (status === 'published' ? new Date() : null),
    commentCount: options.commentCount ?? 0,
    annotationCount: options.annotationCount ?? 0,
  });
  await db.insert(jobs).values({ id: jobId, comparisonId, status: 'scheduled' });
  await db.insert(turns).values({
    id: turnId,
    comparisonId,
    position: 0,
    prompt: 'Explain a sliding-window rate limiter with Go code.',
  });
  const baseResponseId = uuidv7();
  await db.insert(responses).values({
    id: baseResponseId,
    comparisonId,
    turnId,
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
        turnId,
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
    baseResponseId,
    baseModelId: baseModel.id,
    baseModelSlug: baseModel.slug,
    challengerModelIds: challengerModels.map((model) => model.id),
    challengerSlugs: challengerModels.map((model) => model.slug),
    runIds: runRows.map((row) => row.id),
    async cleanup() {
      // A fixture-owned author takes every Comparison they created with them;
      // a shared author cannot, so remove this Comparison by id first.
      if (options.authorId) {
        await db.delete(comparisons).where(eq(comparisons.id, comparisonId));
      } else {
        await db.delete(users).where(eq(users.id, userId));
      }
      await db.delete(models).where(inArray(models.id, modelRows.map((row) => row.id)));
    },
  };
}

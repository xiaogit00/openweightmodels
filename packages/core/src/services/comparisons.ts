import { and, count, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../db/client';
import {
  comparisons,
  jobs,
  models,
  responses,
} from '../db/schema';
import { CATEGORIES, type ComparisonCard } from '../domain/types';
import {
  estimateTokens,
  parseMarkdownUpload,
  validatePrompt,
  validateTitle,
} from '../domain/upload';
import { logActivity, logJobEvent } from '../events';
import { getCardById } from '../queries';
import { enqueueRun } from '../queue';
import { conflict, forbidden, notFound, tooMany } from './errors';
import { finalizeJob } from './jobs';

function maxChallengers() {
  return Number(process.env.MAX_CHALLENGERS ?? 4);
}

function clampEffort(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw conflict('invalid_effort', 'Effort must be 1, 2 or 3.');
  }
  return value;
}

function normaliseCategories(input: string[]) {
  const allowed = new Set<string>(CATEGORIES);
  const unique = [...new Set(input.filter((value) => allowed.has(value)))];
  if (unique.length !== input.length) {
    throw conflict('invalid_category', 'One of those categories is not recognised.');
  }
  return unique;
}

async function assertQuota(userId: string) {
  const db = getDb();
  const jobsPerHour = Number(process.env.JOBS_PER_HOUR ?? 10);
  const runsPerDay = Number(process.env.RUNS_PER_DAY ?? 50);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [jobsRow] = await db
    .select({ total: count() })
    .from(jobs)
    .innerJoin(comparisons, eq(jobs.comparisonId, comparisons.id))
    .where(and(eq(comparisons.authorId, userId), gte(jobs.createdAt, hourAgo)));

  if (Number(jobsRow?.total ?? 0) >= jobsPerHour) {
    throw tooMany(`You can schedule ${jobsPerHour} comparisons per hour. Try again later.`);
  }

  const [runsRow] = await db
    .select({ total: count() })
    .from(responses)
    .innerJoin(comparisons, eq(responses.comparisonId, comparisons.id))
    .where(
      and(
        eq(comparisons.authorId, userId),
        eq(responses.isBase, false),
        gte(responses.createdAt, dayStart),
      ),
    );

  if (Number(runsRow?.total ?? 0) >= runsPerDay) {
    throw tooMany(`You have reached today's limit of ${runsPerDay} generations.`);
  }
}

export type CreateComparisonInput = {
  authorId: string;
  fileName: string;
  fileText: string;
  baseModelId: string;
  prompt: string;
  modelIds: string[];
  title: string;
  categories: string[];
  effort: number;
};

export type CreateComparisonResult = {
  id: string;
  jobId: string;
  title: string;
};

export async function createComparison(
  input: CreateComparisonInput,
): Promise<CreateComparisonResult> {
  const db = getDb();
  await assertQuota(input.authorId);

  const parsed = parseMarkdownUpload(input.fileText, input.fileName);
  const prompt = validatePrompt(input.prompt || parsed.prompt || '');
  const title = validateTitle(input.title || parsed.titleFromFile);
  const categories = normaliseCategories(input.categories);
  const effort = clampEffort(input.effort);
  const challengerIds = [...new Set(input.modelIds)];

  if (!challengerIds.length) {
    throw conflict('no_challengers', 'Choose at least one model to compare against.');
  }
  if (challengerIds.length > maxChallengers()) {
    throw conflict(
      'too_many_challengers',
      `You can compare against at most ${maxChallengers()} models.`,
    );
  }
  if (challengerIds.includes(input.baseModelId)) {
    throw conflict('base_in_challengers', 'The base model cannot also be a challenger.');
  }

  const modelRows = await db
    .select()
    .from(models)
    .where(inArray(models.id, [input.baseModelId, ...challengerIds]));
  const modelMap = new Map(modelRows.map((row) => [row.id, row]));
  if (!modelMap.get(input.baseModelId)?.enabled) {
    throw conflict('invalid_base_model', 'That base model is not available.');
  }
  if (challengerIds.some((id) => !modelMap.get(id)?.enabled)) {
    throw conflict('invalid_challenger', 'One of those models is not available.');
  }

  const comparisonId = uuidv7();
  const jobId = uuidv7();
  const baseResponseId = uuidv7();
  const challengerResponseIds = challengerIds.map(() => uuidv7());

  await db.transaction(async (tx) => {
    await tx.insert(comparisons).values({
      id: comparisonId,
      authorId: input.authorId,
      title,
      prompt,
      categories,
      effort,
      baseModelId: input.baseModelId,
      status: 'generating',
    });

    await tx.insert(jobs).values({
      id: jobId,
      comparisonId,
      status: 'scheduled',
    });

    await tx.insert(responses).values({
      id: baseResponseId,
      comparisonId,
      modelId: input.baseModelId,
      isBase: true,
      contentMd: parsed.body,
      tokens: estimateTokens(parsed.body),
      latencyMs: 0,
      status: 'done',
      finishedAt: new Date(),
    });

    await tx.insert(responses).values(
      challengerIds.map((modelId, index) => ({
        id: challengerResponseIds[index]!,
        comparisonId,
        jobId,
        modelId,
        isBase: false,
        status: 'queued' as const,
      })),
    );
  });

  await logJobEvent({
    jobId,
    kind: 'job.scheduled',
    payload: { comparisonId, models: challengerIds },
  });

  await Promise.all(challengerResponseIds.map((id) => enqueueRun(id)));

  return { id: comparisonId, jobId, title };
}

export async function publishComparison(id: string, userId: string): Promise<ComparisonCard> {
  const db = getDb();
  const existing = await getCardById(id);
  const [row] = await db
    .select()
    .from(comparisons)
    .where(and(eq(comparisons.id, id), isNull(comparisons.deletedAt)))
    .limit(1);

  if (!row) throw notFound('Comparison not found.');
  if (row.authorId !== userId) throw forbidden('Only the author can publish this comparison.');
  if (row.status === 'published') {
    if (!existing) throw notFound('Comparison not found.');
    return existing;
  }
  if (row.status !== 'ready') {
    throw conflict('not_ready', 'Wait until every response has finished or been skipped.');
  }

  const [doneRow] = await db
    .select({ total: count() })
    .from(responses)
    .where(
      and(
        eq(responses.comparisonId, id),
        eq(responses.isBase, false),
        eq(responses.status, 'done'),
      ),
    );

  if (Number(doneRow?.total ?? 0) < 1) {
    throw conflict('no_done_responses', 'At least one challenger response is required.');
  }

  await db
    .update(comparisons)
    .set({ status: 'published', publishedAt: new Date() })
    .where(eq(comparisons.id, id));

  const card = await getCardById(id);
  if (!card) throw notFound('Comparison not found.');

  await logActivity({
    kind: 'comparison.published',
    actorId: userId,
    comparisonId: id,
    summary: `compared ${card.models[0]?.name ?? 'a model'} vs ${card.models[1]?.name ?? 'a model'}`,
    payload: { card },
  });

  return card;
}

export async function unpublishComparison(id: string, userId: string) {
  const db = getDb();
  const row = await requireOwnedComparison(id, userId);
  if (row.status !== 'published') {
    throw conflict('not_published', 'That comparison is not published.');
  }
  await db
    .update(comparisons)
    .set({ status: 'ready', publishedAt: null })
    .where(eq(comparisons.id, id));
}

export async function softDeleteComparison(id: string, userId: string) {
  const db = getDb();
  await requireOwnedComparison(id, userId);
  await db.update(comparisons).set({ deletedAt: new Date() }).where(eq(comparisons.id, id));
}

export async function updateComparison(
  id: string,
  userId: string,
  patch: { title?: string; categories?: string[]; effort?: number },
) {
  const db = getDb();
  await requireOwnedComparison(id, userId);
  const values: Partial<typeof comparisons.$inferInsert> = {};
  if (patch.title !== undefined) values.title = validateTitle(patch.title);
  if (patch.categories !== undefined) values.categories = normaliseCategories(patch.categories);
  if (patch.effort !== undefined) values.effort = clampEffort(patch.effort);
  if (!Object.keys(values).length) return;
  await db.update(comparisons).set(values).where(eq(comparisons.id, id));
}

export async function addModelToComparison(
  comparisonId: string,
  modelId: string,
  userId: string,
): Promise<{ jobId: string; responseId: string }> {
  const db = getDb();
  const row = await requireOwnedComparison(comparisonId, userId);
  if (row.status !== 'ready' && row.status !== 'published') {
    throw conflict('not_ready', 'Wait for the current job before adding a model.');
  }
  if (modelId === row.baseModelId) {
    throw conflict('base_model', 'The base model is already part of this comparison.');
  }

  const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
  if (!model?.enabled) throw conflict('invalid_model', 'That model is not available.');

  const [challengerCount] = await db
    .select({ total: count() })
    .from(responses)
    .where(and(eq(responses.comparisonId, comparisonId), eq(responses.isBase, false)));
  if (Number(challengerCount?.total ?? 0) >= maxChallengers()) {
    throw conflict(
      'too_many_challengers',
      `A comparison can hold at most ${maxChallengers()} challengers.`,
    );
  }

  const [existing] = await db
    .select({ id: responses.id })
    .from(responses)
    .where(and(eq(responses.comparisonId, comparisonId), eq(responses.modelId, modelId)))
    .limit(1);
  if (existing) throw conflict('model_exists', 'That model already has a response here.');

  const jobId = uuidv7();
  const responseId = uuidv7();

  await db.transaction(async (tx) => {
    await tx.insert(jobs).values({ id: jobId, comparisonId, status: 'scheduled' });
    await tx.insert(responses).values({
      id: responseId,
      comparisonId,
      jobId,
      modelId,
      isBase: false,
      status: 'queued',
    });
    if (row.status !== 'published') {
      await tx
        .update(comparisons)
        .set({ status: 'generating' })
        .where(eq(comparisons.id, comparisonId));
    }
  });

  await enqueueRun(responseId);
  return { jobId, responseId };
}

export async function retryRun(responseId: string, userId: string) {
  const db = getDb();
  const [response] = await db
    .select()
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!response || response.isBase) throw notFound('Response not found.');
  const comparison = await requireOwnedComparison(response.comparisonId, userId);
  if (response.status !== 'failed') {
    throw conflict('not_failed', 'Only a failed response can be retried.');
  }

  await db
    .update(responses)
    .set({
      status: 'queued',
      error: null,
      finishedAt: null,
      attempt: response.attempt + 1,
    })
    .where(eq(responses.id, responseId));

  if (comparison.status === 'ready') {
    await db
      .update(comparisons)
      .set({ status: 'generating' })
      .where(eq(comparisons.id, comparison.id));
  }

  await enqueueRun(responseId);
}

export async function skipRun(responseId: string, userId: string) {
  const db = getDb();
  const [response] = await db
    .select()
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!response || response.isBase) throw notFound('Response not found.');
  await requireOwnedComparison(response.comparisonId, userId);
  if (response.status !== 'failed' && response.status !== 'queued') {
    throw conflict('not_skippable', 'That response cannot be skipped now.');
  }

  await db
    .update(responses)
    .set({ status: 'skipped', finishedAt: new Date(), error: null })
    .where(eq(responses.id, responseId));

  if (response.jobId) await finalizeJob(response.jobId);
}

export async function requireOwnedComparison(id: string, userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(comparisons)
    .where(and(eq(comparisons.id, id), isNull(comparisons.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Comparison not found.');
  if (row.authorId !== userId) throw forbidden('Only the author can change this comparison.');
  return row;
}

export async function comparisonExists(id: string) {
  const [row] = await getDb()
    .select({ id: comparisons.id })
    .from(comparisons)
    .where(and(eq(comparisons.id, id), isNull(comparisons.deletedAt)))
    .limit(1);
  return Boolean(row);
}

export function comparisonStatusLabel(status: string) {
  return status === 'generating' ? 'Generating' : status === 'published' ? 'Published' : status;
}

export const comparisonSql = sql;

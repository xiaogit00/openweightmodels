import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  comparisons,
  jobs,
  models,
  notifications,
  responses,
  users,
} from '../db/schema';
import { logActivity, logJobEvent } from '../events';
import { getProvider } from '../providers';
import { enqueueAutoSkip } from '../queue';

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'API timeout';
    return error.message.slice(0, 1000);
  }
  return 'Unknown provider error';
}

export async function processRun(responseId: string) {
  const db = getDb();
  const [response] = await db
    .select()
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);

  if (!response || response.isBase) return;

  const [comparison] = await db
    .select()
    .from(comparisons)
    .where(eq(comparisons.id, response.comparisonId))
    .limit(1);
  if (!comparison) return;

  const [model] = await db
    .select()
    .from(models)
    .where(eq(models.id, response.modelId))
    .limit(1);
  if (!model) {
    await db
      .update(responses)
      .set({ status: 'failed', error: 'Unknown model', finishedAt: new Date() })
      .where(and(eq(responses.id, responseId), eq(responses.status, 'queued')));
    if (response.jobId) {
      await enqueueAutoSkip(responseId, response.attempt);
      await finalizeJob(response.jobId);
    }
    return;
  }

  // Claim the Run atomically: two workers holding the same BullMQ job (or a
  // retry racing the previous attempt) must not both call the provider.
  const [claimed] = await db
    .update(responses)
    .set({ status: 'calling', error: null })
    .where(and(eq(responses.id, responseId), eq(responses.status, 'queued')))
    .returning({ id: responses.id });
  if (!claimed) return;

  if (response.jobId) {
    await db
      .update(jobs)
      .set({
        status: 'running',
        startedAt: sql`coalesce(${jobs.startedAt}, now())`,
      })
      .where(eq(jobs.id, response.jobId));
  }

  if (comparison.status !== 'published') {
    await db
      .update(comparisons)
      .set({ status: 'generating' })
      .where(eq(comparisons.id, comparison.id));
  }

  if (response.jobId) {
    await logJobEvent({
      jobId: response.jobId,
      responseId,
      kind: 'response.status',
      payload: {
        responseId,
        modelId: response.modelId,
        modelName: model.displayName,
        status: 'calling',
        tokens: 0,
      },
    });
  }

  const startedAt = Date.now();
  let text = '';
  let tokens = 0;
  let lastUpdate = 0;

  try {
    const provider = getProvider(model);
    const result = await provider.generate({
      model,
      prompt: comparison.prompt,
      attempt: response.attempt,
      onToken: async (chunk) => {
        text += chunk;
        tokens = Math.max(1, Math.ceil(text.length / 4));
        const now = Date.now();
        if (now - lastUpdate < 500) return;
        lastUpdate = now;

        await db
          .update(responses)
          .set({ status: 'streaming', tokens })
          .where(eq(responses.id, responseId));

        if (response.jobId) {
          await logJobEvent({
            jobId: response.jobId,
            responseId,
            kind: 'response.status',
            payload: {
              responseId,
              modelId: response.modelId,
              modelName: model.displayName,
              status: 'streaming',
              tokens,
            },
          });
        }
      },
    });

    const latencyMs = Date.now() - startedAt;
    await db
      .update(responses)
      .set({
        status: 'done',
        contentMd: result.text,
        tokens: result.tokens,
        latencyMs,
        costUsd: result.costUsd === null ? null : String(result.costUsd),
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(responses.id, responseId));

    if (response.jobId) {
      await logJobEvent({
        jobId: response.jobId,
        responseId,
        kind: 'response.status',
        payload: {
          responseId,
          modelId: response.modelId,
          modelName: model.displayName,
          status: 'done',
          tokens: result.tokens,
          latencyMs,
        },
      });
    }
  } catch (error) {
    const message = errorMessage(error);
    const latencyMs = Date.now() - startedAt;
    await db
      .update(responses)
      .set({
        status: 'failed',
        error: message,
        tokens,
        latencyMs,
        finishedAt: new Date(),
      })
      .where(eq(responses.id, responseId));

    if (response.jobId) {
      await logJobEvent({
        jobId: response.jobId,
        responseId,
        kind: 'response.status',
        payload: {
          responseId,
          modelId: response.modelId,
          modelName: model.displayName,
          status: 'failed',
          tokens,
          latencyMs,
          error: message,
        },
      });
      await enqueueAutoSkip(responseId, response.attempt);
    }
  } finally {
    if (response.jobId) await finalizeJob(response.jobId);
  }
}

export async function finalizeJob(jobId: string) {
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)
      .for('update');
    if (!job || job.status === 'ready' || job.status === 'failed') return null;

    const runs = await tx
      .select({ status: responses.status })
      .from(responses)
      .where(and(eq(responses.jobId, jobId), eq(responses.isBase, false)));

    if (runs.some((run) => run.status !== 'done' && run.status !== 'skipped')) {
      await tx.update(jobs).set({ status: 'running' }).where(eq(jobs.id, jobId));
      return null;
    }

    const [comparison] = await tx
      .select()
      .from(comparisons)
      .where(eq(comparisons.id, job.comparisonId))
      .limit(1)
      .for('update');

    await tx
      .update(jobs)
      .set({ status: 'ready', finishedAt: new Date() })
      .where(eq(jobs.id, jobId));

    if (comparison && comparison.status === 'generating') {
      await tx
        .update(comparisons)
        .set({ status: 'ready' })
        .where(eq(comparisons.id, comparison.id));
    }

    if (comparison) {
      await tx
        .insert(notifications)
        .values({
          userId: comparison.authorId,
          kind: 'job.ready',
          payload: { jobId, comparisonId: comparison.id },
        })
        // Backed by notifications_job_ready_unique: the only unique constraint
        // this insert can hit.
        .onConflictDoNothing();
    }

    return { comparison, runs };
  });

  if (!result) return;
  const { comparison, runs } = result;

  await logJobEvent({
    jobId,
    kind: 'job.ready',
    payload: {
      comparisonId: comparison?.id,
      done: runs.filter((run) => run.status === 'done').length,
      skipped: runs.filter((run) => run.status === 'skipped').length,
    },
  });

  if (comparison?.status === 'published') {
    const [author] = await db
      .select({ handle: users.handle })
      .from(users)
      .where(eq(users.id, comparison.authorId))
      .limit(1);
    await logActivity({
      kind: 'run.finished',
      actorId: comparison.authorId,
      comparisonId: comparison.id,
      summary: `${author?.handle ?? 'someone'} finished a response on ${comparison.title}`,
    });
  }
}

export async function autoSkipRun(responseId: string) {
  const db = getDb();
  const [response] = await db
    .select()
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!response || response.status !== 'failed') return;

  await db
    .update(responses)
    .set({ status: 'skipped', error: null, finishedAt: new Date() })
    .where(eq(responses.id, responseId));

  if (response.jobId) await finalizeJob(response.jobId);
}

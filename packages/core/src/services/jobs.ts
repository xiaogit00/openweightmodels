import { and, eq, gt, gte, inArray, ne, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  comparisons,
  jobs,
  models,
  notifications,
  responses,
  turns,
  users,
} from '../db/schema';
import { logActivity, logJobEvent } from '../events';
import { reportError } from '../error-reporting';
import { getProvider, type ChatMessage } from '../providers';
import { getCardById } from '../queries';
import { enqueueAutoSkip, enqueueRun } from '../queue';
import { assertWithinSpendCap } from '../spend';
import type { ResponseStatus } from '../domain/types';

/**
 * One JSON line per settled Run. CloudWatch Logs metric filters turn these into
 * the Job failure-rate alarm; the same line is readable in `aws logs tail`.
 */
type RunContext = {
  responseId: string;
  jobId: string | null;
  comparisonId: string;
  modelId: string;
  modelSlug: string;
  attempt: number;
};

function logJobMetric(outcome: 'finished' | 'failed', context: RunContext & { error?: string }) {
  console.log(
    JSON.stringify({
      metric: 'job',
      outcome,
      at: new Date().toISOString(),
      ...context,
    }),
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'API timeout';
    return error.message.slice(0, 1000);
  }
  return 'Unknown provider error';
}

type RunForEvent = {
  id: string;
  jobId: string | null;
  modelId: string;
  tokens: number;
};

/**
 * Persist and publish a Run status change. Every transition the Job page can
 * see goes through here, so the payload shape stays consistent.
 */
export async function recordRunStatus(
  response: RunForEvent,
  status: ResponseStatus,
  extra: Record<string, unknown> = {},
) {
  if (!response.jobId) return;
  await logJobEvent({
    jobId: response.jobId,
    responseId: response.id,
    kind: 'response.status',
    payload: {
      responseId: response.id,
      modelId: response.modelId,
      status,
      tokens: response.tokens,
      ...extra,
    },
  });
}

/**
 * The message array for one Turn of one Challenger's Replay: every user message
 * up to this Turn, interleaved with that Model's own earlier replies. The Base
 * model's replies and reasoning content are never included.
 *
 * Returns null when an earlier Turn is not finished yet; a worker must not run
 * a Turn out of order.
 */
async function replayMessages(
  comparisonId: string,
  modelId: string,
  currentTurnId: string,
): Promise<ChatMessage[] | null> {
  const db = getDb();
  const [currentTurn] = await db
    .select()
    .from(turns)
    .where(eq(turns.id, currentTurnId))
    .limit(1);
  if (!currentTurn) return null;

  const [turnRows, ownRows] = await Promise.all([
    db
      .select()
      .from(turns)
      .where(eq(turns.comparisonId, comparisonId))
      .orderBy(turns.position),
    db
      .select()
      .from(responses)
      .where(
        and(
          eq(responses.comparisonId, comparisonId),
          eq(responses.modelId, modelId),
          ne(responses.turnId, currentTurnId),
        ),
      ),
  ]);
  const ownByTurn = new Map(ownRows.map((row) => [row.turnId, row]));

  const messages: ChatMessage[] = [];
  for (const turn of turnRows) {
    if (turn.position > currentTurn.position) break;
    messages.push({ role: 'user', content: turn.prompt });
    if (turn.id === currentTurn.id) break;

    const own = ownByTurn.get(turn.id);
    if (!own || own.status !== 'done') return null;
    messages.push({ role: 'assistant', content: own.contentMd });
  }

  return messages;
}

async function turnPosition(turnId: string) {
  const [turn] = await getDb()
    .select({ position: turns.position })
    .from(turns)
    .where(eq(turns.id, turnId))
    .limit(1);
  return turn?.position ?? null;
}

/** Enqueue this Replay's next Turn once the current one has succeeded. */
async function enqueueNextTurn(response: { comparisonId: string; modelId: string; turnId: string }) {
  const position = await turnPosition(response.turnId);
  if (position === null) return;

  const [next] = await getDb()
    .select({ id: responses.id })
    .from(responses)
    .innerJoin(turns, eq(responses.turnId, turns.id))
    .where(
      and(
        eq(responses.comparisonId, response.comparisonId),
        eq(responses.modelId, response.modelId),
        eq(responses.status, 'queued'),
        gt(turns.position, position),
      ),
    )
    .orderBy(turns.position)
    .limit(1);
  if (next) await enqueueRun(next.id);
}

/**
 * Stop one Challenger's Replay at a Turn: every queued or failed Turn from
 * here on becomes skipped, and the Job can settle without answers to a
 * conversation that did not happen.
 */
export async function stopReplayAt(response: {
  comparisonId: string;
  modelId: string;
  turnId: string;
}) {
  const db = getDb();
  const position = await turnPosition(response.turnId);
  if (position === null) return;

  const targets = await db
    .select({ id: responses.id })
    .from(responses)
    .innerJoin(turns, eq(responses.turnId, turns.id))
    .where(
      and(
        eq(responses.comparisonId, response.comparisonId),
        eq(responses.modelId, response.modelId),
        gte(turns.position, position),
        inArray(responses.status, ['queued', 'failed']),
      ),
    );
  if (!targets.length) return;

  const stopped = await db
    .update(responses)
    .set({ status: 'skipped', error: null, finishedAt: new Date() })
    .where(inArray(responses.id, targets.map((target) => target.id)))
    .returning();
  for (const run of stopped) await recordRunStatus(run, 'skipped');
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

  // The Turn holds the script; a Response only points at it. Reading the Turn
  // here keeps the provider call independent of `comparisons.prompt`.
  const [turn] = await db
    .select()
    .from(turns)
    .where(eq(turns.id, response.turnId))
    .limit(1);

  if (!model || !turn) {
    const error = model ? 'Unknown turn' : 'Unknown model';
    await db
      .update(responses)
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where(and(eq(responses.id, responseId), eq(responses.status, 'queued')));
    if (response.jobId) {
      await enqueueAutoSkip(responseId, response.attempt);
      await finalizeJob(response.jobId);
    }
    return;
  }

  // Disabling a Model in the admin registry stops it from being called. A Run
  // that was already queued fails with a clear message rather than silently
  // generating on a disabled model; the Author can retry once it is enabled.
  if (!model.enabled) {
    const [failed] = await db
      .update(responses)
      .set({ status: 'failed', error: 'Model disabled', finishedAt: new Date() })
      .where(and(eq(responses.id, responseId), eq(responses.status, 'queued')))
      .returning({ id: responses.id });
    if (!failed) return;
    if (response.jobId) {
      await recordRunStatus(response, 'failed', {
        modelName: model.displayName,
        tokens: 0,
        error: 'Model disabled',
      });
      await enqueueAutoSkip(responseId, response.attempt);
      await finalizeJob(response.jobId);
    }
    return;
  }

  // A Replay is sequential: Turn n only runs after this Model's own Turn n-1 is
  // done. A worker that arrives early no-ops; the previous Turn enqueues it.
  const messages = await replayMessages(response.comparisonId, response.modelId, turn.id);
  if (!messages) return;

  const runContext: RunContext = {
    responseId,
    jobId: response.jobId,
    comparisonId: response.comparisonId,
    modelId: response.modelId,
    modelSlug: model.slug,
    attempt: response.attempt,
  };

  // Defence in depth: the API checks the cap before scheduling, but a Run can
  // be queued before the cap is reached. Stop before the provider is called
  // rather than discovering the overspend on the invoice.
  try {
    await assertWithinSpendCap();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Monthly spend cap reached';
    const [failed] = await db
      .update(responses)
      .set({ status: 'failed', error: message, finishedAt: new Date() })
      .where(and(eq(responses.id, responseId), eq(responses.status, 'queued')))
      .returning({ id: responses.id });
    if (!failed) return;
    logJobMetric('failed', { ...runContext, error: message });
    if (response.jobId) {
      await recordRunStatus(response, 'failed', {
        modelName: model.displayName,
        tokens: 0,
        error: message,
      });
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
    await recordRunStatus(response, 'calling', {
      modelName: model.displayName,
      tokens: 0,
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
      messages,
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
          await recordRunStatus(response, 'streaming', {
            modelName: model.displayName,
            tokens,
          });
        }
      },
    });

    // A reasoning Model can burn the whole output budget before emitting any
    // visible text. Storing that as Done leaves an empty cell with no
    // explanation, so surface it as a failure the Author can retry.
    if (!result.text.trim()) {
      tokens = result.tokens;
      throw new Error(
        'The model returned no text. It may have used its entire output budget on reasoning.',
      );
    }

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
      await recordRunStatus(response, 'done', {
        modelName: model.displayName,
        tokens: result.tokens,
        latencyMs,
      });
    }

    logJobMetric('finished', runContext);

    // Continue this Challenger's Replay in Turn order. Other Challengers are
    // already running independently.
    await enqueueNextTurn(response);
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

    logJobMetric('failed', { ...runContext, error: message });
    await reportError(error, {
      ...runContext,
      turnId: turn.id,
      tokens,
      latencyMs,
    });

    if (response.jobId) {
      await recordRunStatus(response, 'failed', {
        modelName: model.displayName,
        tokens,
        latencyMs,
        error: message,
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
    // The Board needs the settled card, not just a ticker line: an added
    // Challenger changes the model list and snippets of a live card.
    const card = await getCardById(comparison.id);
    await logActivity({
      kind: 'run.finished',
      actorId: comparison.authorId,
      comparisonId: comparison.id,
      summary: `${author?.handle ?? 'someone'} finished a response on ${comparison.title}`,
      payload: card ? { card } : {},
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

  await stopReplayAt(response);

  if (response.jobId) await finalizeJob(response.jobId);
}

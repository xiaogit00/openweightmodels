import { and, count, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../db/client';
import {
  comparisons,
  jobs,
  models,
  responses,
  turns,
} from '../db/schema';
import { CATEGORIES, type ComparisonCard } from '../domain/types';
import { resolveMaxChallengers } from '../domain/new-comparison';
import { parseConversationUpload } from '../domain/conversation-import';
import {
  estimateTokens,
  summariseMarkdown,
  validateBaseOutput,
  validatePrompt,
  validateTitle,
  validateTurnScript,
  type ConversationTurnInput,
} from '../domain/upload';
import { logActivity, logJobEvent } from '../events';
import { getCardById } from '../queries';
import { enqueueRun, removeAutoSkip } from '../queue';
import { conflict, forbidden, notFound, tooMany } from './errors';
import { assertCanWrite } from './identity';
import { finalizeJob, recordRunStatus, stopReplayAt } from './jobs';
import { assertWithinSpendCap } from '../spend';

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
    throw tooMany(
      `You can schedule ${jobsPerHour} comparisons per hour.`,
      60 * 60,
    );
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
    const nextDay = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    throw tooMany(
      `You have reached today's limit of ${runsPerDay} Runs.`,
      Math.max(1, Math.ceil((nextDay.getTime() - Date.now()) / 1000)),
    );
  }
}

export type CreateComparisonInput = {
  authorId: string;
  /** Upload path: the markdown file and its name. */
  fileName?: string;
  fileText?: string;
  /** Write path: the Base output, pasted instead of uploaded. */
  baseOutput?: string;
  /**
   * Multi-Turn path: one Prompt and one Base reply per Turn. The import form
   * (ticket 21) will build this; the service accepts it now so a Replay can be
   * created and exercised end to end.
   */
  turns?: ConversationTurnInput[];
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

type ResolvedConversation = {
  turns: ConversationTurnInput[];
  /** The prompt the file carried, if it carried one. */
  prompt: string | null;
  /** Only a file gives a useful default title. */
  titleFromFile: string | null;
};

function resolveConversation(input: CreateComparisonInput): ResolvedConversation {
  if (input.turns !== undefined) {
    // Validation happens after the form's headline Prompt has filled an empty
    // first Turn, so `prompt` can stand in for a source that carried none.
    return {
      turns: input.turns,
      prompt: null,
      titleFromFile: null,
    };
  }

  if (input.fileText !== undefined) {
    const imported = parseConversationUpload(input.fileText, input.fileName ?? '');
    // An AI Exporter file carries one Prompt per Turn. A legacy or bare
    // markdown file stays a one-Turn Conversation, where the form's Prompt
    // still wins over the file's, matching the pre-Turn behaviour.
    const turns =
      imported.format === 'ai-exporter'
        ? imported.turns
        : [
            {
              prompt: input.prompt || imported.prompt || imported.turns[0]?.prompt || '',
              baseOutput: imported.turns[0]!.baseOutput,
            },
          ];
    return {
      turns,
      prompt: imported.prompt,
      titleFromFile: imported.titleFromFile,
    };
  }

  return {
    turns: [{ prompt: '', baseOutput: validateBaseOutput(input.baseOutput ?? '') }],
    prompt: null,
    titleFromFile: null,
  };
}

/**
 * A one-Turn Conversation with an explicit Prompt, as supplied by the existing
 * upload and pasted-reply paths. The multi-Turn path brings its own Prompts.
 */
function withHeadlinePrompt(turns: ConversationTurnInput[], prompt: string) {
  return turns.map((turn, index) =>
    index === 0 && !turn.prompt.trim() ? { ...turn, prompt } : turn,
  );
}

export async function createComparison(
  input: CreateComparisonInput,
): Promise<CreateComparisonResult> {
  await assertCanWrite(input.authorId);
  const db = getDb();
  await assertQuota(input.authorId);
  await assertWithinSpendCap();

  const conversation = resolveConversation(input);
  const conversationTurns = validateTurnScript(
    withHeadlinePrompt(
      conversation.turns,
      input.prompt || conversation.prompt || conversation.turns[0]?.prompt || '',
    ),
  );
  const prompt = conversationTurns[0]!.prompt;
  const title = validateTitle(
    input.title ||
      summariseMarkdown(prompt, 80) ||
      conversation.titleFromFile ||
      'Untitled comparison',
  );
  const categories = normaliseCategories(input.categories);
  const effort = clampEffort(input.effort);
  const challengerIds = [...new Set(input.modelIds)];
  const maxChallengers = resolveMaxChallengers(process.env.MAX_CHALLENGERS);

  if (!challengerIds.length) {
    throw conflict('no_challengers', 'Choose at least one model to compare against.');
  }
  if (challengerIds.length > maxChallengers) {
    throw conflict(
      'too_many_challengers',
      `You can compare against at most ${maxChallengers} models.`,
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
  const turnIds = conversationTurns.map(() => uuidv7());
  const baseResponseIds = conversationTurns.map(() => uuidv7());
  // One Response per Challenger per Turn. Only the first Turn of each Replay is
  // enqueued; a successful Run enqueues its own next Turn, so Challengers run in
  // parallel while each Replay stays in order.
  const challengerResponseIds = challengerIds.map(() =>
    conversationTurns.map(() => uuidv7()),
  );

  await db.transaction(async (tx) => {
    await tx.insert(comparisons).values({
      id: comparisonId,
      authorId: input.authorId,
      title,
      // The first Turn's Prompt is the headline; Turns hold the script.
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

    await tx.insert(turns).values(
      conversationTurns.map((turn, position) => ({
        id: turnIds[position]!,
        comparisonId,
        position,
        prompt: turn.prompt,
      })),
    );

    await tx.insert(responses).values(
      conversationTurns.map((turn, position) => ({
        id: baseResponseIds[position]!,
        comparisonId,
        turnId: turnIds[position]!,
        modelId: input.baseModelId,
        isBase: true,
        contentMd: turn.baseOutput,
        tokens: estimateTokens(turn.baseOutput),
        latencyMs: 0,
        status: 'done' as const,
        finishedAt: new Date(),
      })),
    );

    await tx.insert(responses).values(
      challengerIds.flatMap((modelId, modelIndex) =>
        conversationTurns.map((_turn, position) => ({
          id: challengerResponseIds[modelIndex]![position]!,
          comparisonId,
          turnId: turnIds[position]!,
          jobId,
          modelId,
          isBase: false,
          status: 'queued' as const,
        })),
      ),
    );
  });

  await logJobEvent({
    jobId,
    kind: 'job.scheduled',
    payload: { comparisonId, models: challengerIds, turns: conversationTurns.length },
  });

  await Promise.all(
    challengerResponseIds.map((responseIds) => enqueueRun(responseIds[0]!)),
  );

  return { id: comparisonId, jobId, title };
}

export async function publishComparison(id: string, userId: string): Promise<ComparisonCard> {
  await assertCanWrite(userId);
  const db = getDb();
  const [row] = await db
    .select()
    .from(comparisons)
    .where(and(eq(comparisons.id, id), isNull(comparisons.deletedAt)))
    .limit(1);

  if (!row) throw notFound('Comparison not found.');
  if (row.authorId !== userId) throw forbidden('Only the author can publish this comparison.');
  if (row.status === 'published') {
    const card = await getCardById(id);
    if (!card) throw notFound('Comparison not found.');
    return card;
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

  const [published] = await db
    .update(comparisons)
    .set({ status: 'published', publishedAt: new Date() })
    .where(and(eq(comparisons.id, id), eq(comparisons.status, 'ready')))
    .returning({ id: comparisons.id });

  if (!published) {
    // Another publish won the race. Treat it as success only if it really
    // published; never report a half-applied transition as done.
    const current = await getCardById(id);
    const [latest] = await db
      .select({ status: comparisons.status })
      .from(comparisons)
      .where(eq(comparisons.id, id))
      .limit(1);
    if (latest?.status === 'published') {
      if (!current) throw notFound('Comparison not found.');
      return current;
    }
    throw conflict('not_ready', 'Wait until every response has finished or been skipped.');
  }

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
  await assertCanWrite(userId);
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
  await assertCanWrite(userId);
  const db = getDb();
  await requireOwnedComparison(id, userId);
  await db.update(comparisons).set({ deletedAt: new Date() }).where(eq(comparisons.id, id));
}

export async function updateComparison(
  id: string,
  userId: string,
  patch: { title?: string; categories?: string[]; effort?: number },
) {
  await assertCanWrite(userId);
  const db = getDb();
  await requireOwnedComparison(id, userId);
  const values: Partial<typeof comparisons.$inferInsert> = {};
  if (patch.title !== undefined) values.title = validateTitle(patch.title);
  if (patch.categories !== undefined) values.categories = normaliseCategories(patch.categories);
  if (patch.effort !== undefined) values.effort = clampEffort(patch.effort);
  if (!Object.keys(values).length) return;
  await db.update(comparisons).set(values).where(eq(comparisons.id, id));
}

export type AddModelResult = {
  jobId: string;
  /** The first Turn's Response; later Turns are queued behind it. */
  responseId: string;
  turnCount: number;
  /** Turns × the one new Challenger. */
  estimatedCalls: number;
  responses: Array<{ id: string; turnId: string; position: number }>;
};

export async function addModelToComparison(
  comparisonId: string,
  modelId: string,
  userId: string,
): Promise<AddModelResult> {
  await assertCanWrite(userId);
  const db = getDb();
  await assertWithinSpendCap();
  const row = await requireOwnedComparison(comparisonId, userId);
  if (row.status !== 'ready' && row.status !== 'published') {
    throw conflict('not_ready', 'Wait for the current job before adding a model.');
  }
  if (modelId === row.baseModelId) {
    throw conflict('base_model', 'The base model is already part of this comparison.');
  }

  const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
  if (!model?.enabled) throw conflict('invalid_model', 'That model is not available.');

  const maxChallengers = resolveMaxChallengers(process.env.MAX_CHALLENGERS);
  const challengerRows = await db
    .select({ modelId: responses.modelId })
    .from(responses)
    .where(
      and(
        eq(responses.comparisonId, comparisonId),
        eq(responses.isBase, false),
        // A dismissed (skipped) Run is no longer a Challenger; it must not hold
        // one of the four slots open forever. Its model still counts as used
        // for the duplicate check below.
        ne(responses.status, 'skipped'),
      ),
    );
  // A Replay has one Response per Turn; the cap counts Challengers, not Turns.
  const challengerCount = new Set(challengerRows.map((row) => row.modelId)).size;
  if (challengerCount >= maxChallengers) {
    throw conflict(
      'too_many_challengers',
      `A comparison can hold at most ${maxChallengers} challengers.`,
    );
  }

  const [existing] = await db
    .select({ id: responses.id })
    .from(responses)
    .where(and(eq(responses.comparisonId, comparisonId), eq(responses.modelId, modelId)))
    .limit(1);
  if (existing) throw conflict('model_exists', 'That model already has a response here.');

  // An added Challenger replays the whole stored Conversation: one queued
  // Response per Turn, with only the first Turn enqueued. A successful Turn
  // enqueues its own successor, exactly as a creation-time Replay does.
  const turnRows = await db
    .select({ id: turns.id, position: turns.position })
    .from(turns)
    .where(eq(turns.comparisonId, comparisonId))
    .orderBy(turns.position);
  if (!turnRows.length) {
    throw conflict('no_turns', 'That comparison has no turns to compare.');
  }

  const jobId = uuidv7();
  const responseIds = turnRows.map(() => uuidv7());
  const newResponses = turnRows.map((turn, index) => ({
    id: responseIds[index]!,
    turnId: turn.id,
    position: turn.position,
  }));

  await db.transaction(async (tx) => {
    await tx.insert(jobs).values({ id: jobId, comparisonId, status: 'scheduled' });
    await tx.insert(responses).values(
      newResponses.map((response) => ({
        id: response.id,
        comparisonId,
        turnId: response.turnId,
        jobId,
        modelId,
        isBase: false,
        status: 'queued' as const,
      })),
    );
    if (row.status !== 'published') {
      await tx
        .update(comparisons)
        .set({ status: 'generating' })
        .where(eq(comparisons.id, comparisonId));
    }
  });

  await enqueueRun(responseIds[0]!);
  return {
    jobId,
    responseId: responseIds[0]!,
    turnCount: turnRows.length,
    estimatedCalls: turnRows.length,
    responses: newResponses,
  };
}

export async function retryRun(responseId: string, userId: string) {
  await assertCanWrite(userId);
  await assertWithinSpendCap();
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

  if (response.jobId) {
    await recordRunStatus(response, 'queued', {
      tokens: 0,
      attempt: response.attempt + 1,
    });
  }

  // A second failure should get a fresh 24-hour window, not inherit the
  // timer from the attempt that just failed.
  await enqueueRun(responseId);
  await removeAutoSkip(responseId, response.attempt);
}

export async function skipRun(responseId: string, userId: string) {
  await assertCanWrite(userId);
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

  // Skipping stops this Challenger's Replay: every later Queued Turn is
  // skipped too, so the transcript never answers a conversation that stopped.
  await stopReplayAt(response);

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

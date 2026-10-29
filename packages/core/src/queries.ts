import {
  and,
  arrayContains,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { getDb } from './db/client';
import {
  annotationMessages,
  annotations,
  comments,
  comparisons,
  jobs,
  models,
  notifications,
  responses,
  turns,
  users,
  votes,
} from './db/schema';
import { decodeCursor, encodeCursor, CursorError } from './domain/cursor';
import { BOARD_PAGE_SIZE, emptyBoardFacets } from './domain/filters';
import { summariseMarkdown } from './domain/upload';
import { DELETED_AUTHOR_HANDLE, runProgress } from './domain/types';
import type {
  AnnotationThreadMessage,
  AnnotationView,
  BoardFacets,
  BoardPage,
  CardModel,
  CommentView,
  ComparisonCard,
  ComparisonStatus,
  JobRunState,
  PublicUser,
  Sort,
} from './domain/types';

export type ModelRow = typeof models.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
export type ComparisonRow = typeof comparisons.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;

export type ListOptions = {
  cat?: string | null;
  models?: string[];
  effort?: number | null;
  q?: string | null;
  sort?: Sort;
  cursor?: string | null;
  limit?: number;
};

export type ListResult = BoardPage;

/**
 * The public handle for a stored user. Deleted accounts render as `[deleted]`
 * (never as `@deleted`); unonboarded/legacy rows get an id-based fallback that
 * cannot collide with a claimable handle.
 */
function handleFor(user: UserRow | undefined) {
  if (!user) return 'unknown';
  if (user.deletedAt) return DELETED_AUTHOR_HANDLE;
  return user.handle ?? `member-${user.id.slice(0, 8)}`;
}

function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    handle: handleFor(user),
    avatarUrl: user.avatarUrl,
    image: user.image,
  };
}

function snippet(markdown: string) {
  return summariseMarkdown(markdown, 220);
}

/** A done Response with its Turn's position, so a card can pick Turn 1. */
type CardResponse = { response: ResponseRow; turnPosition: number };

type CardData = {
  responsesByComparison: Map<string, CardResponse[]>;
  turnCounts: Map<string, number>;
  modelMap: Map<string, ModelRow>;
};

/**
 * Loads everything a card needs from Turns and Responses. The Board page and
 * the live publish payload both go through here, so their projection cannot
 * drift apart.
 */
async function loadCardData(
  comparisonIds: string[],
  extraModelIds: string[] = [],
): Promise<CardData> {
  const empty: CardData = {
    responsesByComparison: new Map(),
    turnCounts: new Map(),
    modelMap: new Map(),
  };
  if (!comparisonIds.length) return empty;

  const db = getDb();
  const [responseRows, turnRows] = await Promise.all([
    db
      .select({ response: responses, turnPosition: turns.position })
      .from(responses)
      .innerJoin(turns, eq(turns.id, responses.turnId))
      .where(
        and(inArray(responses.comparisonId, comparisonIds), eq(responses.status, 'done')),
      )
      .orderBy(responses.createdAt),
    db
      .select({ comparisonId: turns.comparisonId })
      .from(turns)
      .where(inArray(turns.comparisonId, comparisonIds)),
  ]);

  const modelIds = [
    ...new Set([
      ...extraModelIds,
      ...responseRows.map((entry) => entry.response.modelId),
    ]),
  ];
  const modelRows = modelIds.length
    ? await db.select().from(models).where(inArray(models.id, modelIds))
    : [];

  const responsesByComparison = new Map<string, CardResponse[]>();
  for (const entry of responseRows) {
    const list = responsesByComparison.get(entry.response.comparisonId) ?? [];
    list.push(entry);
    responsesByComparison.set(entry.response.comparisonId, list);
  }
  const turnCounts = new Map<string, number>();
  for (const turn of turnRows) {
    turnCounts.set(turn.comparisonId, (turnCounts.get(turn.comparisonId) ?? 0) + 1);
  }

  return {
    responsesByComparison,
    turnCounts,
    modelMap: new Map(modelRows.map((row) => [row.id, row])),
  };
}

function cardFromRows(
  comparison: ComparisonRow,
  author: UserRow | undefined,
  cardData: CardData,
): ComparisonCard {
  const ordered = [...(cardData.responsesByComparison.get(comparison.id) ?? [])].sort(
    (a, b) => {
      if (a.response.isBase !== b.response.isBase) return a.response.isBase ? -1 : 1;
      if (a.turnPosition !== b.turnPosition) return a.turnPosition - b.turnPosition;
      // UUIDv7 ids preserve insertion order, so Challengers keep the order the
      // Author picked them in even when a fixture shares one timestamp.
      return a.response.id.localeCompare(b.response.id);
    },
  );
  // The preview comes from Turn 1 only; a later Turn never stands in for the
  // Conversation's opening.
  const opening = ordered.filter((entry) => entry.turnPosition === 0);
  const base = opening.find((entry) => entry.response.isBase)?.response;
  const challenger = opening.find((entry) => !entry.response.isBase)?.response;

  const cardModels: CardModel[] = [];
  const seenModels = new Set<string>();
  for (const { response } of ordered) {
    if (seenModels.has(response.modelId)) continue;
    const model = cardData.modelMap.get(response.modelId);
    if (!model) continue;
    seenModels.add(response.modelId);
    cardModels.push({
      id: model.id,
      slug: model.slug,
      name: model.displayName,
      monogram: model.monogram,
    });
  }

  return {
    id: comparison.id,
    title: comparison.title,
    // The denormalised first Turn's Prompt, which Board search also reads.
    headline: comparison.prompt,
    turnCount: Math.max(1, cardData.turnCounts.get(comparison.id) ?? 0),
    categories: comparison.categories,
    effort: comparison.effort,
    models: cardModels,
    baseSnippet: base ? snippet(base.contentMd) : '',
    challengerSnippet: challenger ? snippet(challenger.contentMd) : '',
    commentCount: comparison.commentCount,
    annotationCount: comparison.annotationCount,
    author: {
      handle: handleFor(author),
      avatarUrl: author?.avatarUrl ?? author?.image ?? null,
    },
    publishedAt: (comparison.publishedAt ?? comparison.createdAt).toISOString(),
    createdAt: comparison.createdAt.toISOString(),
  };
}

export async function listComparisons(options: ListOptions = {}): Promise<ListResult> {
  const db = getDb();
  const sort: Sort = options.sort ?? 'live';
  const limit = Math.min(Math.max(options.limit ?? BOARD_PAGE_SIZE, 1), 100);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (cursor && cursor.sort !== sort) throw new CursorError();

  const baseConditions = [
    eq(comparisons.status, 'published'),
    isNull(comparisons.deletedAt),
    isNull(comparisons.takedownAt),
  ];

  if (options.cat && options.cat !== 'All') {
    baseConditions.push(arrayContains(comparisons.categories, [options.cat]));
  }
  if (options.effort) {
    baseConditions.push(eq(comparisons.effort, options.effort));
  }
  if (options.models?.length) {
    baseConditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(responses)
          .innerJoin(models, eq(responses.modelId, models.id))
          .where(
            and(
              eq(responses.comparisonId, comparisons.id),
              eq(responses.status, 'done'),
              inArray(models.slug, options.models),
            ),
          ),
      ),
    );
  }
  if (options.q?.trim()) {
    const pattern = `%${options.q.trim()}%`;
    baseConditions.push(
      or(
        ilike(comparisons.title, pattern),
        // The headline Prompt is the Conversation's identity; an edited title
        // must not remove it from discovery.
        ilike(comparisons.prompt, pattern),
        exists(
          db
            .select({ one: sql`1` })
            .from(responses)
            .innerJoin(models, eq(responses.modelId, models.id))
            .where(
              and(
                eq(responses.comparisonId, comparisons.id),
                eq(responses.status, 'done'),
                ilike(models.displayName, pattern),
              ),
            ),
        ),
      )!,
    );
  }

  const conditions = [...baseConditions];
  if (cursor) {
    if (sort === 'top') {
      const score = sql`(${comparisons.commentCount} + 2 * ${comparisons.annotationCount})`;
      conditions.push(
        sql`(${score}, ${comparisons.publishedAt}, ${comparisons.id}) < (${cursor.score}::int, ${cursor.publishedAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    } else if (sort === 'new') {
      conditions.push(
        sql`(${comparisons.createdAt}, ${comparisons.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    } else {
      conditions.push(
        sql`(${comparisons.publishedAt}, ${comparisons.id}) < (${cursor.publishedAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    }
  }

  const order =
    sort === 'top'
      ? [
          desc(sql`(${comparisons.commentCount} + 2 * ${comparisons.annotationCount})`),
          desc(comparisons.publishedAt),
          desc(comparisons.id),
        ]
      : sort === 'new'
        ? [desc(comparisons.createdAt), desc(comparisons.id)]
        : [desc(comparisons.publishedAt), desc(comparisons.id)];

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(comparisons)
      .where(and(...conditions))
      .orderBy(...order)
      .limit(limit + 1),
    db
      .select({ total: count() })
      .from(comparisons)
      .where(and(...baseConditions)),
  ]);

  const page = rows.slice(0, limit);
  const total = Number(totalRow[0]?.total ?? 0);
  if (!page.length) {
    return { items: [], total, nextCursor: null };
  }

  const ids = page.map((row) => row.id);
  const [authorRows, cardData] = await Promise.all([
    db
      .select()
      .from(users)
      .where(inArray(users.id, [...new Set(page.map((row) => row.authorId))])),
    loadCardData(
      ids,
      page.map((row) => row.baseModelId),
    ),
  ]);
  const authorMap = new Map(authorRows.map((row) => [row.id, row]));

  const items = page.map((comparison) =>
    cardFromRows(comparison, authorMap.get(comparison.authorId), cardData),
  );

  let nextCursor: string | null = null;
  const last = page[page.length - 1];
  if (rows.length > limit && last) {
    nextCursor = encodeCursor({
      sort,
      id: last.id,
      publishedAt: last.publishedAt?.toISOString() ?? null,
      createdAt: last.createdAt.toISOString(),
      score: last.commentCount + 2 * last.annotationCount,
    });
  }

  return { items, total, nextCursor };
}

/**
 * Sidebar counts across every published Comparison, independent of the active
 * filters. The Board fetches this once per page load and patches it from live
 * publish events, so scrolling pages never pays for another aggregate.
 */
export async function getBoardFacets(): Promise<BoardFacets> {
  const db = getDb();
  const published = and(
    eq(comparisons.status, 'published'),
    isNull(comparisons.deletedAt),
    isNull(comparisons.takedownAt),
  );

  const [categoryRows, modelRows, totalRow] = await Promise.all([
    db.execute<{ category: string; total: number }>(sql`
      select c.category as category, count(*)::int as total
      from ${comparisons}
      cross join lateral unnest(${comparisons.categories}) as c(category)
      where ${published}
      group by c.category
    `),
    db
      .select({ slug: models.slug, total: countDistinct(comparisons.id) })
      .from(comparisons)
      .innerJoin(responses, eq(responses.comparisonId, comparisons.id))
      .innerJoin(models, eq(models.id, responses.modelId))
      .where(and(published, eq(responses.status, 'done')))
      .groupBy(models.slug),
    db.select({ total: count() }).from(comparisons).where(published),
  ]);

  const categories = emptyBoardFacets().categories;
  for (const row of categoryRows) {
    categories[row.category] = Number(row.total);
  }

  const modelCounts: Record<string, number> = {};
  for (const row of modelRows) {
    modelCounts[row.slug] = Number(row.total);
  }

  return {
    categories,
    models: modelCounts,
    total: Number(totalRow[0]?.total ?? 0),
  };
}

export type ComparisonBundle = {
  comparison: ComparisonRow;
  author: PublicUser;
  baseModel: ModelRow;
  turns: Array<{ id: string; position: number; prompt: string }>;
  responses: Array<{ response: ResponseRow; model: ModelRow }>;
};

export async function getComparisonForViewer(
  id: string,
  viewerId: string | null,
  viewerIsAdmin = false,
): Promise<ComparisonBundle | null> {
  const db = getDb();
  const [comparison] = await db
    .select()
    .from(comparisons)
    .where(eq(comparisons.id, id))
    .limit(1);

  if (!comparison || comparison.deletedAt) return null;
  // A taken-down Comparison is gone from public and author routes; an Admin
  // can still open that hidden record to review or restore it. Admins do not
  // gain access to other people's drafts or in-progress work.
  const adminCanReview = viewerIsAdmin && comparison.takedownAt !== null;
  if (comparison.takedownAt && !adminCanReview) return null;
  if (comparison.status !== 'published' && comparison.authorId !== viewerId) {
    return null;
  }

  const [author] = await db
    .select()
    .from(users)
    .where(eq(users.id, comparison.authorId))
    .limit(1);
  const [baseModel] = await db
    .select()
    .from(models)
    .where(eq(models.id, comparison.baseModelId))
    .limit(1);

  if (!author || !baseModel) return null;

  const [allResponseRows, turnRows] = await Promise.all([
    db
      .select()
      .from(responses)
      .where(eq(responses.comparisonId, id))
      .orderBy(responses.createdAt),
    db
      .select({ id: turns.id, position: turns.position, prompt: turns.prompt })
      .from(turns)
      .where(eq(turns.comparisonId, id))
      .orderBy(turns.position),
  ]);
  // An added Challenger is public once it has a done Response. A stopped
  // Replay keeps its done Turns and its skipped tail visible so readers can see
  // where it stopped; pending and failed Responses stay on the Author's page.
  const doneModelIds = new Set(
    allResponseRows.filter((row) => row.status === 'done').map((row) => row.modelId),
  );
  const responseRows =
    comparison.authorId === viewerId
      ? allResponseRows
      : allResponseRows.filter(
          (row) => row.status === 'done' || (row.status === 'skipped' && doneModelIds.has(row.modelId)),
        );
  const modelIds = [...new Set(responseRows.map((row) => row.modelId))];
  const modelRows = modelIds.length
    ? await db.select().from(models).where(inArray(models.id, modelIds))
    : [];
  const modelMap = new Map(modelRows.map((row) => [row.id, row]));

  return {
    comparison,
    author: toPublicUser(author),
    baseModel,
    turns: turnRows,
    responses: responseRows
      .map((response) => {
        const model = modelMap.get(response.modelId);
        return model ? { response, model } : null;
      })
      .filter((entry): entry is { response: ResponseRow; model: ModelRow } => Boolean(entry)),
  };
}

export async function getAnnotationViews(
  comparisonId: string,
  viewerId: string | null,
): Promise<AnnotationView[]> {
  const db = getDb();
  const responseRows = await db
    .select({ id: responses.id })
    .from(responses)
    .where(eq(responses.comparisonId, comparisonId));
  const responseIds = responseRows.map((row) => row.id);
  if (!responseIds.length) return [];

  const annotationRows = await db
    .select()
    .from(annotations)
    .where(
      and(
        inArray(annotations.responseId, responseIds),
        isNull(annotations.deletedAt),
        isNull(annotations.hiddenAt),
      ),
    )
    .orderBy(annotations.createdAt);
  const annotationIds = annotationRows.map((row) => row.id);
  if (!annotationIds.length) return [];

  const [messageRows, voteRows, myVoteRows] = await Promise.all([
    db
      .select()
      .from(annotationMessages)
      .where(inArray(annotationMessages.annotationId, annotationIds))
      .orderBy(annotationMessages.createdAt),
    db
      .select({ targetId: votes.targetId, total: count() })
      .from(votes)
      .where(and(eq(votes.targetType, 'annotation'), inArray(votes.targetId, annotationIds)))
      .groupBy(votes.targetId),
    viewerId
      ? db
          .select({ targetId: votes.targetId })
          .from(votes)
          .where(
            and(
              eq(votes.userId, viewerId),
              eq(votes.targetType, 'annotation'),
              inArray(votes.targetId, annotationIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const authorIds = [
    ...new Set([
      ...annotationRows.map((row) => row.authorId),
      ...messageRows.map((row) => row.authorId),
    ]),
  ];
  const authorRows = authorIds.length
    ? await db.select().from(users).where(inArray(users.id, authorIds))
    : [];
  const authorMap = new Map(authorRows.map((row) => [row.id, toPublicUser(row)]));
  const voteMap = new Map(voteRows.map((row) => [row.targetId, Number(row.total)]));
  const myVotes = new Set(myVoteRows.map((row) => row.targetId));
  const messagesByAnnotation = new Map<string, typeof messageRows>();
  for (const message of messageRows) {
    const list = messagesByAnnotation.get(message.annotationId) ?? [];
    list.push(message);
    messagesByAnnotation.set(message.annotationId, list);
  }

  return annotationRows.map((annotation) => ({
    id: annotation.id,
    responseId: annotation.responseId,
    kind: annotation.kind,
    startOffset: annotation.startOffset,
    endOffset: annotation.endOffset,
    quote: annotation.quote,
    createdAt: annotation.createdAt.toISOString(),
    author: authorMap.get(annotation.authorId) ?? {
      id: annotation.authorId,
      handle: 'unknown',
      avatarUrl: null,
      image: null,
    },
    votes: voteMap.get(annotation.id) ?? 0,
    voted: myVotes.has(annotation.id),
    thread: (messagesByAnnotation.get(annotation.id) ?? []).map((message) => ({
      id: message.id,
      body: message.deletedAt ? '' : message.body,
      createdAt: message.createdAt.toISOString(),
      deletedAt: message.deletedAt?.toISOString() ?? null,
      author: authorMap.get(message.authorId) ?? {
        id: message.authorId,
        handle: 'unknown',
        avatarUrl: null,
        image: null,
      },
    })),
  }));
}

export async function getCommentViews(
  comparisonId: string,
  viewerId: string | null,
): Promise<CommentView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.comparisonId, comparisonId), isNull(comments.hiddenAt)))
    .orderBy(comments.createdAt);
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);
  const [authorRows, modelRows, voteRows, myVoteRows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((row) => row.authorId))])),
    rows.some((row) => row.aboutModelId)
      ? db
          .select()
          .from(models)
          .where(
            inArray(
              models.id,
              [
                ...new Set(
                  rows
                    .map((row) => row.aboutModelId)
                    .filter((id): id is string => Boolean(id)),
                ),
              ],
            ),
          )
      : Promise.resolve([]),
    db
      .select({ targetId: votes.targetId, total: count() })
      .from(votes)
      .where(and(eq(votes.targetType, 'comment'), inArray(votes.targetId, ids)))
      .groupBy(votes.targetId),
    viewerId
      ? db
          .select({ targetId: votes.targetId })
          .from(votes)
          .where(
            and(
              eq(votes.userId, viewerId),
              eq(votes.targetType, 'comment'),
              inArray(votes.targetId, ids),
            ),
          )
      : Promise.resolve([]),
  ]);

  const authorMap = new Map(authorRows.map((row) => [row.id, toPublicUser(row)]));
  const modelMap = new Map(modelRows.map((row) => [row.id, row]));
  const voteMap = new Map(voteRows.map((row) => [row.targetId, Number(row.total)]));
  const myVotes = new Set(myVoteRows.map((row) => row.targetId));

  const views = new Map<string, CommentView>();
  for (const row of rows) {
    const about = row.aboutModelId ? modelMap.get(row.aboutModelId) : null;
    views.set(row.id, {
      id: row.id,
      body: row.deletedAt ? '' : row.body,
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      author: authorMap.get(row.authorId) ?? {
        id: row.authorId,
        handle: 'unknown',
        avatarUrl: null,
        image: null,
      },
      aboutModel: about ? { slug: about.slug, name: about.displayName } : null,
      votes: voteMap.get(row.id) ?? 0,
      voted: myVotes.has(row.id),
      replies: [],
    });
  }

  const roots: CommentView[] = [];
  for (const row of rows) {
    const view = views.get(row.id);
    if (!view) continue;
    if (row.parentId) {
      views.get(row.parentId)?.replies.push(view);
    } else {
      roots.push(view);
    }
  }
  return roots;
}

export type JobBundle = {
  job: JobRow;
  comparison: ComparisonRow;
  author: PublicUser;
  baseModel: CardModel | null;
  baseSnippet: string;
  challengerSnippet: string;
  runs: JobRunState[];
};

export async function getJobForAuthor(
  jobId: string,
  viewerId: string | null,
): Promise<JobBundle | null> {
  if (!viewerId) return null;
  const db = getDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;
  const [comparison] = await db
    .select()
    .from(comparisons)
    .where(eq(comparisons.id, job.comparisonId))
    .limit(1);
  if (!comparison || comparison.authorId !== viewerId || comparison.deletedAt) return null;
  if (comparison.takedownAt) return null;

  const [author] = await db
    .select()
    .from(users)
    .where(eq(users.id, comparison.authorId))
    .limit(1);
  const [turnRows, runRows] = await Promise.all([
    db
      .select()
      .from(turns)
      .where(eq(turns.comparisonId, comparison.id))
      .orderBy(turns.position),
    db
      .select()
      .from(responses)
      .where(and(eq(responses.jobId, jobId), eq(responses.isBase, false)))
      .orderBy(responses.createdAt),
  ]);
  const turnMap = new Map(turnRows.map((turn) => [turn.id, turn]));
  const turnCount = turnRows.length;
  const orderedRuns = [...runRows].sort((left, right) => {
    const leftTurn = turnMap.get(left.turnId)?.position ?? 0;
    const rightTurn = turnMap.get(right.turnId)?.position ?? 0;
    if (leftTurn !== rightTurn) return leftTurn - rightTurn;
    return left.modelId.localeCompare(right.modelId);
  });
  const modelIds = [
    ...new Set([comparison.baseModelId, ...runRows.map((row) => row.modelId)]),
  ];
  const modelRows = await db.select().from(models).where(inArray(models.id, modelIds));
  const modelMap = new Map(modelRows.map((row) => [row.id, row]));
  const baseModelRow = modelMap.get(comparison.baseModelId);
  const firstTurnId = turnRows[0]?.id;
  const [baseResponse] = firstTurnId
    ? await db
        .select()
        .from(responses)
        .where(
          and(
            eq(responses.comparisonId, comparison.id),
            eq(responses.turnId, firstTurnId),
            eq(responses.isBase, true),
          ),
        )
        .limit(1)
    : [];

  return {
    job,
    comparison,
    author: author ? toPublicUser(author) : {
      id: comparison.authorId,
      handle: 'unknown',
      avatarUrl: null,
      image: null,
    },
    baseModel: baseModelRow
      ? {
          id: baseModelRow.id,
          slug: baseModelRow.slug,
          name: baseModelRow.displayName,
          monogram: baseModelRow.monogram,
        }
      : null,
    baseSnippet: baseResponse ? snippet(baseResponse.contentMd) : '',
    challengerSnippet: (() => {
      const firstDone = orderedRuns.find((row) => row.status === 'done');
      return firstDone ? snippet(firstDone.contentMd) : '';
    })(),
    runs: orderedRuns.map((response) => {
      const model = modelMap.get(response.modelId);
      const turn = turnMap.get(response.turnId);
      return {
        id: response.id,
        modelId: response.modelId,
        modelName: model?.displayName ?? 'Unknown model',
        monogram: model?.monogram ?? '??',
        status: response.status,
        tokens: response.tokens,
        latencyMs: response.latencyMs,
        error: response.error,
        attempt: response.attempt,
        progress: runProgress(response.status, response.tokens),
        turnId: response.turnId,
        turnNumber: (turn?.position ?? 0) + 1,
        turnCount: Math.max(1, turnCount),
      };
    }),
  };
}

export async function getJobForComparisonForAuthor(
  comparisonId: string,
  viewerId: string | null,
): Promise<JobBundle | null> {
  if (!viewerId) return null;
  const [job] = await getDb()
    .select()
    .from(jobs)
    .where(eq(jobs.comparisonId, comparisonId))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  if (!job) return null;
  return getJobForAuthor(job.id, viewerId);
}

export async function getCardById(id: string): Promise<ComparisonCard | null> {
  const db = getDb();
  const [comparison] = await db
    .select()
    .from(comparisons)
    .where(
      and(
        eq(comparisons.id, id),
        isNull(comparisons.deletedAt),
        isNull(comparisons.takedownAt),
      ),
    )
    .limit(1);
  if (!comparison) return null;

  const [author, cardData] = await Promise.all([
    db.select().from(users).where(eq(users.id, comparison.authorId)).limit(1),
    loadCardData([id], [comparison.baseModelId]),
  ]);

  return cardFromRows(comparison, author[0], cardData);
}

export async function getModels(): Promise<ModelRow[]> {
  return getDb()
    .select()
    .from(models)
    .where(eq(models.enabled, true))
    .orderBy(models.displayName);
}

export async function getUserByHandle(handle: string): Promise<UserRow | null> {
  const [row] = await getDb().select().from(users).where(eq(users.handle, handle)).limit(1);
  return row ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const [row] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function getComparisonRow(id: string) {
  const [row] = await getDb().select().from(comparisons).where(eq(comparisons.id, id)).limit(1);
  return row ?? null;
}

export async function getJobRow(id: string) {
  const [row] = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row ?? null;
}

export async function getUnreadNotificationCount(userId: string) {
  const [row] = await getDb()
    .select({ total: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.total ?? 0);
}

export type NotificationWithComparison = typeof notifications.$inferSelect & {
  /**
   * Resolved at read time. Rows store IDs only, so a draft title is never
   * copied into a notification; callers must scope the read to its owner.
   */
  comparison: { id: string; title: string; status: ComparisonStatus } | null;
};

export async function getNotifications(
  userId: string,
  limit = 20,
): Promise<NotificationWithComparison[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const comparisonIds = [
    ...new Set(
      rows
        .map((row) => row.payload.comparisonId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  if (comparisonIds.length === 0) {
    return rows.map((row) => ({ ...row, comparison: null }));
  }

  const related = await db
    .select({ id: comparisons.id, title: comparisons.title, status: comparisons.status })
    .from(comparisons)
    .where(inArray(comparisons.id, comparisonIds));
  const byId = new Map(related.map((comparison) => [comparison.id, comparison]));

  return rows.map((row) => {
    const comparisonId = row.payload.comparisonId;
    return {
      ...row,
      comparison:
        typeof comparisonId === 'string' ? (byId.get(comparisonId) ?? null) : null,
    };
  });
}

export async function markNotificationsRead(
  userId: string,
  target: { id: string } | { all: true },
) {
  const condition =
    'id' in target
      ? and(
          eq(notifications.userId, userId),
          eq(notifications.id, target.id),
          isNull(notifications.readAt),
        )
      : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await getDb().update(notifications).set({ readAt: new Date() }).where(condition);
}

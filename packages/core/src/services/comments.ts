import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../db/client';
import {
  comments,
  comparisons,
  models,
  users,
  votes,
} from '../db/schema';
import { logActivity, retractActivity } from '../events';
import { conflict, forbidden, notFound } from './errors';
import { assertCanWrite } from './identity';

function assertBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed) throw conflict('body_required', 'Write something first.');
  if (trimmed.length > 5000) throw conflict('body_too_long', 'That comment is too long.');
  return trimmed;
}

export type CreateCommentInput = {
  userId: string;
  comparisonId: string;
  parentId?: string | null;
  aboutModelId?: string | null;
  body: string;
};

export async function createComment(input: CreateCommentInput) {
  await assertCanWrite(input.userId);
  const db = getDb();
  const [comparison] = await db
    .select()
    .from(comparisons)
    .where(and(eq(comparisons.id, input.comparisonId), isNull(comparisons.deletedAt)))
    .limit(1);
  if (!comparison) throw notFound('Comparison not found.');
  if (comparison.takedownAt) throw notFound('Comparison not found.');
  if (comparison.status !== 'published' && comparison.authorId !== input.userId) {
    throw notFound('Comparison not found.');
  }

  let parentId: string | null = null;
  let inheritedAbout: string | null = null;
  if (input.parentId) {
    const [parent] = await db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.id, input.parentId),
          eq(comments.comparisonId, input.comparisonId),
          isNull(comments.deletedAt),
          isNull(comments.hiddenAt),
        ),
      )
      .limit(1);
    if (!parent) throw notFound('Parent comment not found.');
    parentId = parent.parentId ?? parent.id;
    inheritedAbout = parent.aboutModelId;
  }

  const aboutModelId = input.aboutModelId ?? inheritedAbout;
  let aboutModel: { slug: string; name: string } | null = null;
  if (aboutModelId) {
    const [model] = await db
      .select()
      .from(models)
      .where(eq(models.id, aboutModelId))
      .limit(1);
    if (!model) throw conflict('invalid_model', 'That model is not available.');
    aboutModel = { slug: model.slug, name: model.displayName };
  }

  const body = assertBody(input.body);
  const id = uuidv7();

  await db.transaction(async (tx) => {
    await tx.insert(comments).values({
      id,
      comparisonId: input.comparisonId,
      authorId: input.userId,
      parentId,
      aboutModelId: aboutModelId ?? null,
      body,
    });
    await tx
      .update(comparisons)
      .set({ commentCount: sql`${comparisons.commentCount} + 1` })
      .where(eq(comparisons.id, input.comparisonId));
  });

  const [author] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  await logActivity({
    kind: input.parentId ? 'comment.replied' : 'comment.created',
    actorId: input.userId,
    comparisonId: input.comparisonId,
    summary: `${author?.handle ?? 'someone'} ${input.parentId ? 'replied on' : 'commented on'} ${
      comparison.title
    }`,
    payload: { commentId: id },
  });

  return {
    id,
    body,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    author: {
      id: input.userId,
      handle: author?.handle ?? 'unknown',
      avatarUrl: author?.avatarUrl ?? author?.image ?? null,
      image: author?.image ?? null,
    },
    aboutModel,
    votes: 0,
    voted: false,
    replies: [],
  };
}

export async function commentIsUnderHiddenParent(comment: {
  parentId: string | null;
  hiddenAt: Date | null;
}) {
  if (comment.hiddenAt) return true;
  if (!comment.parentId) return false;
  const [parent] = await getDb()
    .select({ hiddenAt: comments.hiddenAt })
    .from(comments)
    .where(eq(comments.id, comment.parentId))
    .limit(1);
  return Boolean(parent?.hiddenAt);
}

async function ownedComment(id: string, userId: string) {
  const db = getDb();
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), isNull(comments.deletedAt), isNull(comments.hiddenAt)))
    .limit(1);
  if (!comment) throw notFound('Comment not found.');
  // A reply follows its parent: an Admin hiding the root hides the thread.
  if (await commentIsUnderHiddenParent(comment)) throw notFound('Comment not found.');
  if (comment.authorId !== userId) throw forbidden('That comment is not yours.');
  return comment;
}

export async function updateComment(id: string, userId: string, body: string) {
  await assertCanWrite(userId);
  const db = getDb();
  await ownedComment(id, userId);
  await db
    .update(comments)
    .set({ body: assertBody(body) })
    .where(eq(comments.id, id));
}

export async function deleteComment(id: string, userId: string) {
  await assertCanWrite(userId);
  const db = getDb();
  const comment = await ownedComment(id, userId);
  const [replyRow] = await db
    .select({ total: count() })
    .from(comments)
    .where(and(eq(comments.parentId, id), isNull(comments.deletedAt)));
  const hasReplies = Number(replyRow?.total ?? 0) > 0;

  await db.transaction(async (tx) => {
    if (hasReplies) {
      await tx.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, id));
    } else {
      await tx.delete(votes).where(and(eq(votes.targetType, 'comment'), eq(votes.targetId, id)));
      await tx.delete(comments).where(eq(comments.id, id));
    }
    await tx
      .update(comparisons)
      .set({ commentCount: sql`greatest(0, ${comparisons.commentCount} - 1)` })
      .where(eq(comparisons.id, comment.comparisonId));
  });

  await retractActivity({
    kind: 'comment.deleted',
    comparisonId: comment.comparisonId,
    payload: { commentId: id },
    match: { commentId: id },
  });
}

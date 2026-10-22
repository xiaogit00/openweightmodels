import { and, count, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { annotationMessages, annotations, comments, votes } from '../db/schema';
import type { VoteTarget } from '../domain/types';
import { conflict, notFound } from './errors';
import { commentIsUnderHiddenParent } from './comments';
import { assertCanWrite } from './identity';

async function targetOwner(targetType: VoteTarget, targetId: string) {
  const db = getDb();
  if (targetType === 'annotation') {
    const [row] = await db
      .select({ authorId: annotations.authorId })
      .from(annotations)
      .where(and(eq(annotations.id, targetId), isNull(annotations.deletedAt), isNull(annotations.hiddenAt)))
      .limit(1);
    if (!row) throw notFound('Annotation not found.');
    return row.authorId;
  }

  if (targetType === 'comment') {
    const [row] = await db
      .select({ authorId: comments.authorId, parentId: comments.parentId, hiddenAt: comments.hiddenAt })
      .from(comments)
      .where(and(eq(comments.id, targetId), isNull(comments.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Comment not found.');
    if (await commentIsUnderHiddenParent(row)) throw notFound('Comment not found.');
    return row.authorId;
  }

  throw conflict('invalid_target', 'Unknown vote target.');
}

export async function toggleVote(
  userId: string,
  targetType: VoteTarget,
  targetId: string,
) {
  await assertCanWrite(userId);
  const db = getDb();
  const ownerId = await targetOwner(targetType, targetId);
  if (ownerId === userId) {
    throw conflict('self_vote', 'You cannot vote on your own content.');
  }

  const [existing] = await db
    .select()
    .from(votes)
    .where(
      and(
        eq(votes.userId, userId),
        eq(votes.targetType, targetType),
        eq(votes.targetId, targetId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .delete(votes)
      .where(
        and(
          eq(votes.userId, userId),
          eq(votes.targetType, targetType),
          eq(votes.targetId, targetId),
        ),
      );
  } else {
    await db.insert(votes).values({ userId, targetType, targetId });
  }

  const [total] = await db
    .select({ total: count() })
    .from(votes)
    .where(and(eq(votes.targetType, targetType), eq(votes.targetId, targetId)));

  return { voted: !existing, count: Number(total?.total ?? 0) };
}

// Keeps the import used in environments where the message table is queried for
// ownership checks in a future revision.
export const voteTargetTables = { annotationMessages };

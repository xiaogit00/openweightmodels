import { and, count, eq, inArray, isNull, like, ne, or, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  activityEvents,
  annotationMessages,
  annotations,
  authAccounts,
  authSessions,
  authVerifications,
  comments,
  comparisons,
  models,
  notifications,
  reports,
  responses,
  users,
  votes,
} from '../db/schema';
import { logActivity } from '../events';
import { DomainError, conflict, notFound } from './errors';

/** The word a member types to confirm deletion. Case-insensitive. */
export const DELETE_ACCOUNT_CONFIRMATION = 'delete';

const CONFIRMATION_MESSAGE =
  'Type DELETE to confirm that you want to delete your account.';

function assertConfirmation(confirmation: string) {
  if (confirmation.trim().toLowerCase() !== DELETE_ACCOUNT_CONFIRMATION) {
    throw new DomainError('confirmation_required', CONFIRMATION_MESSAGE, 400);
  }
}

type IsoDate = string | null;

function iso(value: Date | null | undefined): IsoDate {
  return value ? value.toISOString() : null;
}

export type AccountExport = {
  exportedAt: string;
  formatVersion: 1;
  account: {
    id: string;
    handle: string | null;
    email: string | null;
    displayName: string | null;
    role: string;
    createdAt: string;
    updatedAt: string;
    suspendedAt: IsoDate;
    deletedAt: IsoDate;
  };
  comparisons: Array<{
    id: string;
    title: string;
    prompt: string;
    categories: string[];
    effort: number;
    status: string;
    createdAt: string;
    publishedAt: IsoDate;
    deletedAt: IsoDate;
    takedownAt: IsoDate;
    base: {
      model: string;
      monogram: string;
      contentMd: string;
      tokens: number;
    } | null;
    responses: Array<{
      model: string;
      slug: string;
      monogram: string;
      contentMd: string;
      tokens: number;
      latencyMs: number | null;
      status: string;
      createdAt: string;
      finishedAt: IsoDate;
    }>;
  }>;
  comments: Array<{
    id: string;
    comparisonId: string;
    comparisonTitle: string;
    parentId: string | null;
    body: string;
    createdAt: string;
    deletedAt: IsoDate;
  }>;
  annotations: Array<{
    id: string;
    comparisonId: string;
    comparisonTitle: string;
    model: string;
    kind: string;
    quote: string;
    startOffset: number;
    endOffset: number;
    createdAt: string;
    deletedAt: IsoDate;
    messages: Array<{
      id: string;
      body: string;
      createdAt: string;
      deletedAt: IsoDate;
    }>;
  }>;
  /** Thread messages this account wrote under someone else's Annotation. */
  annotationReplies: Array<{
    id: string;
    annotationId: string;
    comparisonId: string;
    comparisonTitle: string;
    body: string;
    createdAt: string;
    deletedAt: IsoDate;
  }>;
  votes: Array<{
    targetType: string;
    targetId: string;
    createdAt: string;
  }>;
  notifications: Array<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    readAt: IsoDate;
    createdAt: string;
  }>;
  reports: Array<{
    id: string;
    targetType: string;
    targetId: string;
    reason: string;
    detail: string | null;
    status: string;
    resolution: string | null;
    createdAt: string;
    resolvedAt: IsoDate;
  }>;
};

/**
 * A machine-readable copy of everything the account itself owns. Other people's
 * emails, comments and thread replies are deliberately excluded.
 */
export async function exportAccountData(userId: string): Promise<AccountExport> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw notFound('Account not found.');

  const comparisonRows = await db
    .select()
    .from(comparisons)
    .where(eq(comparisons.authorId, userId))
    .orderBy(comparisons.createdAt);
  const comparisonIds = comparisonRows.map((row) => row.id);

  const responseRows = comparisonIds.length
    ? await db
        .select({ response: responses, model: models })
        .from(responses)
        .innerJoin(models, eq(models.id, responses.modelId))
        .where(inArray(responses.comparisonId, comparisonIds))
        .orderBy(responses.createdAt)
    : [];
  const responsesByComparison = new Map<string, typeof responseRows>();
  for (const row of responseRows) {
    const list = responsesByComparison.get(row.response.comparisonId) ?? [];
    list.push(row);
    responsesByComparison.set(row.response.comparisonId, list);
  }

  const commentRows = await db
    .select({ comment: comments, comparisonTitle: comparisons.title })
    .from(comments)
    .innerJoin(comparisons, eq(comparisons.id, comments.comparisonId))
    .where(eq(comments.authorId, userId))
    .orderBy(comments.createdAt);

  const annotationRows = await db
    .select({
      annotation: annotations,
      comparisonId: responses.comparisonId,
      comparisonTitle: comparisons.title,
      model: models.displayName,
    })
    .from(annotations)
    .innerJoin(responses, eq(responses.id, annotations.responseId))
    .innerJoin(comparisons, eq(comparisons.id, responses.comparisonId))
    .innerJoin(models, eq(models.id, responses.modelId))
    .where(eq(annotations.authorId, userId))
    .orderBy(annotations.createdAt);

  const messageRows = await db
    .select({
      message: annotationMessages,
      annotationAuthorId: annotations.authorId,
      comparisonId: responses.comparisonId,
      comparisonTitle: comparisons.title,
    })
    .from(annotationMessages)
    .innerJoin(annotations, eq(annotations.id, annotationMessages.annotationId))
    .innerJoin(responses, eq(responses.id, annotations.responseId))
    .innerJoin(comparisons, eq(comparisons.id, responses.comparisonId))
    .where(eq(annotationMessages.authorId, userId))
    .orderBy(annotationMessages.createdAt);
  const messagesByAnnotation = new Map<string, typeof messageRows>();
  for (const row of messageRows) {
    const list = messagesByAnnotation.get(row.message.annotationId) ?? [];
    list.push(row);
    messagesByAnnotation.set(row.message.annotationId, list);
  }
  const annotationIds = new Set(annotationRows.map((row) => row.annotation.id));

  const [voteRows, notificationRows, reportRows] = await Promise.all([
    db.select().from(votes).where(eq(votes.userId, userId)).orderBy(votes.createdAt),
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(notifications.createdAt),
    db.select().from(reports).where(eq(reports.reporterId, userId)).orderBy(reports.createdAt),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    account: {
      id: user.id,
      handle: user.handle,
      email: user.email,
      displayName: user.name,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      suspendedAt: iso(user.suspendedAt),
      deletedAt: iso(user.deletedAt),
    },
    comparisons: comparisonRows.map((comparison) => {
      const rows = responsesByComparison.get(comparison.id) ?? [];
      const base = rows.find((row) => row.response.isBase);
      return {
        id: comparison.id,
        title: comparison.title,
        prompt: comparison.prompt,
        categories: comparison.categories,
        effort: comparison.effort,
        status: comparison.status,
        createdAt: comparison.createdAt.toISOString(),
        publishedAt: iso(comparison.publishedAt),
        deletedAt: iso(comparison.deletedAt),
        takedownAt: iso(comparison.takedownAt),
        base: base
          ? {
              model: base.model.displayName,
              monogram: base.model.monogram,
              contentMd: base.response.contentMd,
              tokens: base.response.tokens,
            }
          : null,
        responses: rows
          .filter((row) => !row.response.isBase)
          .map(({ response, model }) => ({
            model: model.displayName,
            slug: model.slug,
            monogram: model.monogram,
            contentMd: response.contentMd,
            tokens: response.tokens,
            latencyMs: response.latencyMs,
            status: response.status,
            createdAt: response.createdAt.toISOString(),
            finishedAt: iso(response.finishedAt),
          })),
      };
    }),
    comments: commentRows.map(({ comment, comparisonTitle }) => ({
      id: comment.id,
      comparisonId: comment.comparisonId,
      comparisonTitle,
      parentId: comment.parentId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      deletedAt: iso(comment.deletedAt),
    })),
    annotations: annotationRows.map((row) => ({
      id: row.annotation.id,
      comparisonId: row.comparisonId,
      comparisonTitle: row.comparisonTitle,
      model: row.model,
      kind: row.annotation.kind,
      quote: row.annotation.quote,
      startOffset: row.annotation.startOffset,
      endOffset: row.annotation.endOffset,
      createdAt: row.annotation.createdAt.toISOString(),
      deletedAt: iso(row.annotation.deletedAt),
      messages: (messagesByAnnotation.get(row.annotation.id) ?? []).map(({ message }) => ({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        deletedAt: iso(message.deletedAt),
      })),
    })),
    annotationReplies: messageRows
      .filter((row) => !annotationIds.has(row.message.annotationId))
      .map((row) => ({
        id: row.message.id,
        annotationId: row.message.annotationId,
        comparisonId: row.comparisonId,
        comparisonTitle: row.comparisonTitle,
        body: row.message.body,
        createdAt: row.message.createdAt.toISOString(),
        deletedAt: iso(row.message.deletedAt),
      })),
    votes: voteRows.map((vote) => ({
      targetType: vote.targetType,
      targetId: vote.targetId,
      createdAt: vote.createdAt.toISOString(),
    })),
    notifications: notificationRows.map((notification) => ({
      id: notification.id,
      kind: notification.kind,
      payload: notification.payload,
      readAt: iso(notification.readAt),
      createdAt: notification.createdAt.toISOString(),
    })),
    reports: reportRows.map((report) => ({
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      detail: report.detail,
      status: report.status,
      resolution: report.resolution,
      createdAt: report.createdAt.toISOString(),
      resolvedAt: iso(report.resolvedAt),
    })),
  };
}

/**
 * Deleting an account erases the person, not the public record.
 *
 * - Every personal field (email, handle, name, avatar) is cleared and the row
 *   stays behind as an anonymous attribution for published Comparisons.
 * - Unpublished Comparisons are private work, so they are deleted with their
 *   Responses, Jobs and Discussion.
 * - Discussion comments and Annotations become tombstones. Other people's
 *   replies survive, because deleting a comment should not delete the thread
 *   around it.
 * - Sessions, verification tokens, notifications, reports and votes are removed.
 * - The handle and email are released for reuse.
 *
 * This mirrors what an individual author delete does today, applied to every
 * item the account owns, and keeps `comment_count` / `annotation_count` exact.
 */
export async function deleteAccount(userId: string, confirmation: string) {
  assertConfirmation(confirmation);

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw notFound('Account not found.');
  if (user.deletedAt) {
    throw conflict('account_deleted', 'This account has already been deleted.');
  }

  if (user.role === 'admin') {
    const [others] = await db
      .select({ total: count() })
      .from(users)
      .where(
        and(eq(users.role, 'admin'), isNull(users.deletedAt), ne(users.id, userId)),
      );
    if (Number(others?.total ?? 0) === 0) {
      throw conflict(
        'last_admin',
        'You are the last Admin. Promote another Admin before deleting this account.',
      );
    }
  }

  // Comparisons that were never published are private work and go entirely.
  const ownedComparisons = await db
    .select({
      id: comparisons.id,
      status: comparisons.status,
      deletedAt: comparisons.deletedAt,
    })
    .from(comparisons)
    .where(eq(comparisons.authorId, userId));
  const privateComparisonIds = ownedComparisons
    .filter((row) => row.status !== 'published' || row.deletedAt !== null)
    .map((row) => row.id);

  const ownComments = await db
    .select({
      id: comments.id,
      comparisonId: comments.comparisonId,
      parentId: comments.parentId,
      deletedAt: comments.deletedAt,
      hiddenAt: comments.hiddenAt,
    })
    .from(comments)
    .where(eq(comments.authorId, userId));

  const ownAnnotations = await db
    .select({
      id: annotations.id,
      comparisonId: responses.comparisonId,
      deletedAt: annotations.deletedAt,
      hiddenAt: annotations.hiddenAt,
    })
    .from(annotations)
    .innerJoin(responses, eq(responses.id, annotations.responseId))
    .where(eq(annotations.authorId, userId));

  const ownMessages = await db
    .select({ id: annotationMessages.id, annotationId: annotationMessages.annotationId })
    .from(annotationMessages)
    .where(eq(annotationMessages.authorId, userId));

  // Content inside a Comparison that is about to disappear leaves votes behind
  // (votes are polymorphic, so no foreign key cleans them up).
  const doomedAnnotationIds = privateComparisonIds.length
    ? (
        await db
          .select({ id: annotations.id })
          .from(annotations)
          .innerJoin(responses, eq(responses.id, annotations.responseId))
          .where(inArray(responses.comparisonId, privateComparisonIds))
      ).map((row) => row.id)
    : [];
  const doomedCommentIds = privateComparisonIds.length
    ? (
        await db
          .select({ id: comments.id })
          .from(comments)
          .where(inArray(comments.comparisonId, privateComparisonIds))
      ).map((row) => row.id)
    : [];

  const privateIds = new Set(privateComparisonIds);

  // A reply under an Admin-hidden parent is already excluded from
  // `comment_count`, so tombstoning it must not subtract again.
  const parentIds = [
    ...new Set(
      ownComments
        .map((row) => row.parentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const hiddenParentIds = new Set(
    (
      parentIds.length
        ? await db
            .select({ id: comments.id, hiddenAt: comments.hiddenAt })
            .from(comments)
            .where(inArray(comments.id, parentIds))
        : []
    )
      .filter((row) => row.hiddenAt)
      .map((row) => row.id),
  );

  const commentCountDelta = new Map<string, number>();
  for (const row of ownComments) {
    if (
      row.deletedAt ||
      row.hiddenAt ||
      (row.parentId && hiddenParentIds.has(row.parentId)) ||
      privateIds.has(row.comparisonId)
    ) {
      continue;
    }
    commentCountDelta.set(
      row.comparisonId,
      (commentCountDelta.get(row.comparisonId) ?? 0) + 1,
    );
  }
  const annotationCountDelta = new Map<string, number>();
  for (const row of ownAnnotations) {
    if (row.deletedAt || row.hiddenAt || privateIds.has(row.comparisonId)) continue;
    annotationCountDelta.set(
      row.comparisonId,
      (annotationCountDelta.get(row.comparisonId) ?? 0) + 1,
    );
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    if (privateComparisonIds.length) {
      await tx.delete(comparisons).where(inArray(comparisons.id, privateComparisonIds));
    }

    const annotationVoteTargets = [
      ...new Set([...ownAnnotations.map((row) => row.id), ...doomedAnnotationIds]),
    ];
    const commentVoteTargets = [
      ...new Set([...ownComments.map((row) => row.id), ...doomedCommentIds]),
    ];
    if (annotationVoteTargets.length) {
      await tx
        .delete(votes)
        .where(
          and(
            eq(votes.targetType, 'annotation'),
            inArray(votes.targetId, annotationVoteTargets),
          ),
        );
    }
    if (commentVoteTargets.length) {
      await tx
        .delete(votes)
        .where(
          and(eq(votes.targetType, 'comment'), inArray(votes.targetId, commentVoteTargets)),
        );
    }
    await tx.delete(votes).where(eq(votes.userId, userId));

    // Comments written by the account become tombstones; replies stay.
    await tx
      .update(comments)
      .set({ body: '', deletedAt: now })
      .where(and(eq(comments.authorId, userId), isNull(comments.deletedAt)));

    for (const [comparisonId, total] of commentCountDelta) {
      await tx
        .update(comparisons)
        .set({
          commentCount: sql`greatest(0, ${comparisons.commentCount} - ${total})`,
        })
        .where(eq(comparisons.id, comparisonId));
    }

    // Annotations lose their highlight and thread like an author delete.
    await tx
      .update(annotations)
      .set({ deletedAt: now })
      .where(and(eq(annotations.authorId, userId), isNull(annotations.deletedAt)));

    for (const [comparisonId, total] of annotationCountDelta) {
      await tx
        .update(comparisons)
        .set({
          annotationCount: sql`greatest(0, ${comparisons.annotationCount} - ${total})`,
        })
        .where(eq(comparisons.id, comparisonId));
    }

    // Thread messages written by the account are blanked too.
    await tx
      .update(annotationMessages)
      .set({ body: '', deletedAt: now })
      .where(
        and(eq(annotationMessages.authorId, userId), isNull(annotationMessages.deletedAt)),
      );

    await tx.delete(notifications).where(eq(notifications.userId, userId));
    await tx.delete(reports).where(eq(reports.reporterId, userId));

    // The sign-in identity and every live session end here.
    await tx.delete(authSessions).where(eq(authSessions.userId, userId));
    await tx.delete(authAccounts).where(eq(authAccounts.userId, userId));
    if (user.email) {
      // Better Auth keys verification rows by the hashed token; the address is
      // inside the JSON value. Remove any magic link still pending for this
      // address so deleting an account cannot be followed by a live old link.
      const pending = await tx
        .select({ id: authVerifications.id, value: authVerifications.value })
        .from(authVerifications)
        .where(like(authVerifications.identifier, 'magic-link:%'));
      const pendingIds = pending
        .filter((row) => {
          try {
            return (JSON.parse(row.value) as { email?: unknown }).email === user.email;
          } catch {
            return false;
          }
        })
        .map((row) => row.id);
      if (pendingIds.length) {
        await tx
          .delete(authVerifications)
          .where(inArray(authVerifications.id, pendingIds));
      }
    }

    // Ticker lines name the account or point at content that is disappearing.
    await tx.delete(activityEvents).where(eq(activityEvents.actorId, userId));
    const payloadMatches = [
      ...ownComments.map(
        (row) => sql`${activityEvents.payload}->>'commentId' = ${row.id}`,
      ),
      ...ownAnnotations.map(
        (row) => sql`${activityEvents.payload}->>'annotationId' = ${row.id}`,
      ),
      ...ownMessages.map(
        (row) => sql`${activityEvents.payload}->>'messageId' = ${row.id}`,
      ),
    ];
    if (payloadMatches.length) {
      await tx.delete(activityEvents).where(or(...payloadMatches)!);
    }

    await tx
      .update(users)
      .set({
        handle: null,
        email: null,
        emailVerified: false,
        name: null,
        image: null,
        avatarUrl: null,
        suspendedAt: null,
        suspendedById: null,
        suspensionReason: null,
        role: 'user',
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
  });

  // Tell open Boards that this account's comments and Annotations are gone, so
  // counts and ticker lines settle without a reload. One summary-less event per
  // affected Comparison; `recentActivity` omits it from the ticker. Counts are
  // carried explicitly because already-hidden content is retracted from the
  // ticker but was never part of `comment_count` / `annotation_count`.
  const impacts = new Map<
    string,
    {
      commentIds: string[];
      annotationIds: string[];
      messageIds: string[];
      commentCount: number;
      annotationCount: number;
    }
  >();
  const impactFor = (comparisonId: string) => {
    const existing = impacts.get(comparisonId);
    if (existing) return existing;
    const created = {
      commentIds: [],
      annotationIds: [],
      messageIds: [],
      commentCount: 0,
      annotationCount: 0,
    };
    impacts.set(comparisonId, created);
    return created;
  };

  for (const row of ownComments) {
    if (privateIds.has(row.comparisonId)) continue;
    const impact = impactFor(row.comparisonId);
    impact.commentIds.push(row.id);
    const wasCounted =
      !row.deletedAt &&
      !row.hiddenAt &&
      !(row.parentId && hiddenParentIds.has(row.parentId));
    if (wasCounted) impact.commentCount += 1;
  }
  const annotationComparison = new Map<string, string>();
  for (const row of ownAnnotations) {
    annotationComparison.set(row.id, row.comparisonId);
    if (privateIds.has(row.comparisonId)) continue;
    const impact = impactFor(row.comparisonId);
    impact.annotationIds.push(row.id);
    if (!row.deletedAt && !row.hiddenAt) impact.annotationCount += 1;
  }
  for (const row of ownMessages) {
    const comparisonId = annotationComparison.get(row.annotationId);
    if (!comparisonId || privateIds.has(comparisonId)) continue;
    impactFor(comparisonId).messageIds.push(row.id);
  }

  // The deletion is committed; live updates are cosmetic. A failure to publish
  // must not turn a successful deletion into an error response.
  try {
    for (const [comparisonId, impact] of impacts) {
      await logActivity({
        kind: 'account.deleted',
        comparisonId,
        payload: impact,
      });
    }
  } catch (error) {
    console.error('[account] deletion committed but the Board update failed', error);
  }
}

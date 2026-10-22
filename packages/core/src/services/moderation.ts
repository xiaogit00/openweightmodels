import { and, count, eq, isNull, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../db/client';
import {
  adminActions,
  annotations,
  comments,
  comparisons,
  reports,
  responses,
  users,
} from '../db/schema';
import {
  REPORT_REASONS,
  type ReportReason,
  type ReportStatus,
  type ReportTarget,
} from '../domain/types';
import { logActivity, retractActivity } from '../events';
import { assertAdmin, restoreComparison, takeDownComparison, validateModerationReason } from './admin';
import { DomainError, conflict, notFound } from './errors';
import { commentIsUnderHiddenParent } from './comments';
import { assertCanWrite } from './identity';

function assertReason(reason: string): ReportReason {
  if (!REPORT_REASONS.includes(reason as ReportReason)) {
    throw conflict('invalid_reason', 'Choose a reason for the report.');
  }
  return reason as ReportReason;
}

function assertDetail(detail: string | null | undefined) {
  if (detail === undefined || detail === null) return null;
  const text = detail.trim();
  if (!text) return null;
  if (text.length > 500) {
    throw conflict('detail_too_long', 'Keep the details under 500 characters.');
  }
  return text;
}

function assertTargetType(targetType: string): ReportTarget {
  if (targetType !== 'comparison' && targetType !== 'comment' && targetType !== 'annotation') {
    throw conflict('invalid_target', 'Unknown report target.');
  }
  return targetType;
}

type ReportTargetContext = {
  comparisonId: string;
  authorId: string;
};

/**
 * Resolves what a reader is allowed to report. Hidden, deleted, unpublished and
 * taken-down content is invisible to reporters, so it reports as missing.
 */
async function reportTargetContext(
  targetType: ReportTarget,
  targetId: string,
): Promise<ReportTargetContext> {
  const db = getDb();

  if (targetType === 'comparison') {
    const [row] = await db
      .select()
      .from(comparisons)
      .where(eq(comparisons.id, targetId))
      .limit(1);
    if (
      !row ||
      row.deletedAt ||
      row.takedownAt ||
      row.status !== 'published'
    ) {
      throw notFound('Comparison not found.');
    }
    return { comparisonId: row.id, authorId: row.authorId };
  }

  if (targetType === 'comment') {
    const [row] = await db
      .select({ comment: comments, comparison: comparisons })
      .from(comments)
      .innerJoin(comparisons, eq(comparisons.id, comments.comparisonId))
      .where(eq(comments.id, targetId))
      .limit(1);
    if (
      !row ||
      row.comment.deletedAt ||
      row.comparison.deletedAt ||
      row.comparison.takedownAt ||
      row.comparison.status !== 'published'
    ) {
      throw notFound('Comment not found.');
    }
    if (await commentIsUnderHiddenParent(row.comment)) {
      throw notFound('Comment not found.');
    }
    return { comparisonId: row.comparison.id, authorId: row.comment.authorId };
  }

  const [row] = await db
    .select({ annotation: annotations, response: responses, comparison: comparisons })
    .from(annotations)
    .innerJoin(responses, eq(responses.id, annotations.responseId))
    .innerJoin(comparisons, eq(comparisons.id, responses.comparisonId))
    .where(and(eq(annotations.id, targetId), isNull(annotations.deletedAt)))
    .limit(1);
  if (
    !row ||
    row.annotation.hiddenAt ||
    row.comparison.deletedAt ||
    row.comparison.takedownAt ||
    row.comparison.status !== 'published'
  ) {
    throw notFound('Annotation not found.');
  }
  return { comparisonId: row.comparison.id, authorId: row.annotation.authorId };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export type CreateReportInput = {
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail?: string | null;
};

export type ReportResult = {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  status: ReportStatus;
  duplicate: boolean;
  createdAt: string;
};

/**
 * Files a report. A reader may report the same target once; repeating it
 * returns the existing row with `duplicate: true` so neither the queue nor the
 * audit trail grows from a double click.
 */
export async function createReport(input: CreateReportInput): Promise<ReportResult> {
  await assertCanWrite(input.reporterId);
  const targetType = assertTargetType(input.targetType);
  const reason = assertReason(input.reason);
  const detail = assertDetail(input.detail);
  const target = await reportTargetContext(targetType, input.targetId);

  if (target.authorId === input.reporterId) {
    throw new DomainError('own_content', 'You cannot report your own content.', 400);
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.reporterId, input.reporterId),
        eq(reports.targetType, targetType),
        eq(reports.targetId, input.targetId),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      id: existing.id,
      targetType: existing.targetType,
      targetId: existing.targetId,
      status: existing.status,
      duplicate: true,
      createdAt: existing.createdAt.toISOString(),
    };
  }

  try {
    const [row] = await db
      .insert(reports)
      .values({
        id: uuidv7(),
        reporterId: input.reporterId,
        targetType,
        targetId: input.targetId,
        reason,
        detail,
      })
      .returning();
    if (!row) throw new Error('report was not inserted');
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      status: row.status,
      duplicate: false,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [row] = await db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, input.reporterId),
          eq(reports.targetType, targetType),
          eq(reports.targetId, input.targetId),
        ),
      )
      .limit(1);
    if (!row) throw error;
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      status: row.status,
      duplicate: true,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

type ReportRow = typeof reports.$inferSelect;

async function openReport(reportId: string): Promise<ReportRow> {
  const [row] = await getDb()
    .select()
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!row) throw notFound('Report not found.');
  if (row.status !== 'open') {
    throw conflict('report_closed', 'That report is already closed.');
  }
  return row;
}

/**
 * Closes every still-open report on a target. Hiding the content settles all
 * readers' reports at once, so the queue keeps no stale rows for it.
 */
async function closeOpenReports(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  targetType: ReportTarget,
  targetId: string,
  actorId: string,
  resolution: string,
) {
  await tx
    .update(reports)
    .set({
      status: 'resolved',
      resolvedById: actorId,
      resolvedAt: new Date(),
      resolution,
    })
    .where(
      and(
        eq(reports.targetType, targetType),
        eq(reports.targetId, targetId),
        eq(reports.status, 'open'),
      ),
    );
}

function auditReportResolved(actorId: string, reportId: string, reason: string) {
  return {
    id: uuidv7(),
    actorId,
    action: 'report.resolved' as const,
    targetType: 'report' as const,
    targetId: reportId,
    reason,
  };
}

async function hideComment(actorId: string, report: ReportRow, reason: string) {
  const db = getDb();
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, report.targetId), isNull(comments.deletedAt)))
    .limit(1);
  if (!comment) throw notFound('Comment not found.');
  if (comment.hiddenAt) throw conflict('already_hidden', 'That comment is already hidden.');

  let hiddenCount = 1;
  let hiddenCommentIds = [comment.id];

  await db.transaction(async (tx) => {
    const subtree = await tx
      .select({ id: comments.id, hiddenAt: comments.hiddenAt })
      .from(comments)
      .where(
        and(
          or(eq(comments.id, comment.id), eq(comments.parentId, comment.id)),
          isNull(comments.deletedAt),
        ),
      );
    hiddenCommentIds = subtree.map((row) => row.id);
    hiddenCount = subtree.filter((row) => !row.hiddenAt).length;

    await tx
      .update(comments)
      .set({ hiddenAt: new Date(), hiddenById: actorId, hiddenReason: reason })
      .where(eq(comments.id, comment.id));
    await tx
      .update(comparisons)
      .set({
        commentCount: sql`greatest(0, ${comparisons.commentCount} - ${hiddenCount})`,
      })
      .where(eq(comparisons.id, comment.comparisonId));
    await closeOpenReports(tx, 'comment', comment.id, actorId, reason);
    await tx.insert(adminActions).values([
      {
        id: uuidv7(),
        actorId,
        action: 'comment.hidden',
        targetType: 'comment',
        targetId: comment.id,
        reason,
      },
      auditReportResolved(actorId, report.id, reason),
    ]);
  });

  await retractActivity({
    kind: 'comment.hidden',
    comparisonId: comment.comparisonId,
    payload: { commentId: comment.id, hiddenCount, hiddenCommentIds },
    match: { commentId: hiddenCommentIds },
  });
}

async function hideAnnotation(actorId: string, report: ReportRow, reason: string) {
  const db = getDb();
  const [row] = await db
    .select({ annotation: annotations, response: responses })
    .from(annotations)
    .innerJoin(responses, eq(responses.id, annotations.responseId))
    .where(and(eq(annotations.id, report.targetId), isNull(annotations.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Annotation not found.');
  if (row.annotation.hiddenAt) {
    throw conflict('already_hidden', 'That annotation is already hidden.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(annotations)
      .set({ hiddenAt: new Date(), hiddenById: actorId, hiddenReason: reason })
      .where(eq(annotations.id, row.annotation.id));
    await tx
      .update(comparisons)
      .set({ annotationCount: sql`greatest(0, ${comparisons.annotationCount} - 1)` })
      .where(eq(comparisons.id, row.response.comparisonId));
    await closeOpenReports(tx, 'annotation', row.annotation.id, actorId, reason);
    await tx.insert(adminActions).values([
      {
        id: uuidv7(),
        actorId,
        action: 'annotation.hidden',
        targetType: 'annotation',
        targetId: row.annotation.id,
        reason,
      },
      auditReportResolved(actorId, report.id, reason),
    ]);
  });

  await retractActivity({
    kind: 'annotation.hidden',
    comparisonId: row.response.comparisonId,
    payload: { annotationId: row.annotation.id },
    match: { annotationId: row.annotation.id },
  });
}

/**
 * Hides the content a report points at and settles every open report on that
 * target. Comparisons reuse the takedown path so the Board and ticker treat a
 * moderation removal exactly like an Admin takedown.
 */
export async function hideReportedContent(
  actorId: string,
  reportId: string,
  reason: string,
): Promise<void> {
  await assertAdmin(actorId);
  const reasonText = validateModerationReason(reason);
  const report = await openReport(reportId);

  if (report.targetType === 'comparison') {
    await takeDownComparison(actorId, report.targetId, reasonText);
    const db = getDb();
    await db.transaction(async (tx) => {
      await closeOpenReports(tx, 'comparison', report.targetId, actorId, reasonText);
      await tx
        .insert(adminActions)
        .values(auditReportResolved(actorId, report.id, reasonText));
    });
    return;
  }

  if (report.targetType === 'comment') {
    await hideComment(actorId, report, reasonText);
    return;
  }

  await hideAnnotation(actorId, report, reasonText);
}

/** Closes a report without changing the content. */
export async function dismissReport(
  actorId: string,
  reportId: string,
  note?: string | null,
): Promise<void> {
  await assertAdmin(actorId);
  const report = await openReport(reportId);
  const resolution = note?.trim()
    ? validateModerationReason(note)
    : 'Dismissed after review';
  const db = getDb();

  await db.transaction(async (tx) => {
    await tx
      .update(reports)
      .set({
        status: 'dismissed',
        resolvedById: actorId,
        resolvedAt: new Date(),
        resolution,
      })
      .where(eq(reports.id, report.id));
    await tx.insert(adminActions).values({
      id: uuidv7(),
      actorId,
      action: 'report.dismissed',
      targetType: 'report',
      targetId: report.id,
      reason: resolution,
    });
  });
}

/**
 * Reverses a moderation hide. The Author's own delete is not restored: only
 * content an Admin hid comes back.
 */
export async function restoreModeratedContent(
  actorId: string,
  targetType: ReportTarget,
  targetId: string,
  reason?: string | null,
): Promise<void> {
  await assertAdmin(actorId);
  const reasonText = reason?.trim()
    ? validateModerationReason(reason)
    : 'Restored after review';

  if (targetType === 'comparison') {
    await restoreComparison(actorId, targetId, reasonText);
    return;
  }

  const db = getDb();

  if (targetType === 'comment') {
    const [comment] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, targetId), isNull(comments.deletedAt)))
      .limit(1);
    if (!comment || !comment.hiddenAt) throw notFound('Hidden comment not found.');

    let restoredCount = 1;

    await db.transaction(async (tx) => {
      const [visible] = await tx
        .select({ total: count() })
        .from(comments)
        .where(
          and(
            or(eq(comments.id, comment.id), eq(comments.parentId, comment.id)),
            isNull(comments.deletedAt),
            or(isNull(comments.hiddenAt), eq(comments.id, comment.id)),
          ),
        );
      restoredCount = Number(visible?.total ?? 1);

      await tx
        .update(comments)
        .set({ hiddenAt: null, hiddenById: null, hiddenReason: null })
        .where(eq(comments.id, comment.id));
      await tx
        .update(comparisons)
        .set({ commentCount: sql`${comparisons.commentCount} + ${Number(visible?.total ?? 1)}` })
        .where(eq(comparisons.id, comment.comparisonId));
      await tx.insert(adminActions).values({
        id: uuidv7(),
        actorId,
        action: 'comment.restored',
        targetType: 'comment',
        targetId: comment.id,
        reason: reasonText,
      });
    });

    await logActivity({
      kind: 'comment.restored',
      comparisonId: comment.comparisonId,
      payload: { commentId: comment.id, restoredCount },
    });
    return;
  }

  const [row] = await db
    .select({ annotation: annotations, response: responses })
    .from(annotations)
    .innerJoin(responses, eq(responses.id, annotations.responseId))
    .where(and(eq(annotations.id, targetId), isNull(annotations.deletedAt)))
    .limit(1);
  if (!row || !row.annotation.hiddenAt) throw notFound('Hidden annotation not found.');

  await db.transaction(async (tx) => {
    await tx
      .update(annotations)
      .set({ hiddenAt: null, hiddenById: null, hiddenReason: null })
      .where(eq(annotations.id, row.annotation.id));
    await tx
      .update(comparisons)
      .set({ annotationCount: sql`${comparisons.annotationCount} + 1` })
      .where(eq(comparisons.id, row.response.comparisonId));
    await tx.insert(adminActions).values({
      id: uuidv7(),
      actorId,
      action: 'annotation.restored',
      targetType: 'annotation',
      targetId: row.annotation.id,
      reason: reasonText,
    });
  });

  await logActivity({
    kind: 'annotation.restored',
    comparisonId: row.response.comparisonId,
    payload: { annotationId: row.annotation.id },
  });
}

/** Blocks a member's writes while leaving their reads and sessions intact. */
export async function suspendUser(
  actorId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await assertAdmin(actorId);
  const reasonText = validateModerationReason(reason);
  const db = getDb();
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw notFound('Member not found.');
  if (target.role === 'admin') {
    throw conflict('admin_target', 'Admins cannot be suspended.');
  }
  if (target.suspendedAt) {
    throw conflict('already_suspended', 'That member is already suspended.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        suspendedAt: new Date(),
        suspendedById: actorId,
        suspensionReason: reasonText,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.insert(adminActions).values({
      id: uuidv7(),
      actorId,
      action: 'user.suspended',
      targetType: 'user',
      targetId: userId,
      reason: reasonText,
    });
  });
}

export async function reinstateUser(
  actorId: string,
  userId: string,
  reason?: string | null,
): Promise<void> {
  await assertAdmin(actorId);
  const reasonText = reason?.trim()
    ? validateModerationReason(reason)
    : 'Suspension lifted';
  const db = getDb();
  const [target] = await db
    .select({ id: users.id, suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw notFound('Member not found.');
  if (!target.suspendedAt) {
    throw conflict('not_suspended', 'That member is not suspended.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        suspendedAt: null,
        suspendedById: null,
        suspensionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.insert(adminActions).values({
      id: uuidv7(),
      actorId,
      action: 'user.reinstated',
      targetType: 'user',
      targetId: userId,
      reason: reasonText,
    });
  });
}

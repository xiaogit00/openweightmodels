import { and, count, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../db/client';
import {
  activityEvents,
  adminActions,
  annotations,
  comments,
  comparisons,
  models,
  reports,
  responses,
  users,
} from '../db/schema';
import {
  REPORT_REASON_META,
  type AdminActionKind,
  type AdminTargetType,
  type ComparisonStatus,
  type ReportReason,
  type ReportStatus,
  type ReportTarget,
} from '../domain/types';
import { logActivity } from '../events';
import { getCardById } from '../queries';
import { DomainError, conflict, notFound } from './errors';

export type AdminModel = {
  id: string;
  slug: string;
  displayName: string;
  monogram: string;
  provider: string;
  etaSeconds: number;
  enabled: boolean;
  /** Responses that reference it, including uploaded Base outputs. */
  responseCount: number;
};

export type AdminHiddenComparison = {
  id: string;
  title: string;
  authorHandle: string;
  status: ComparisonStatus;
  publishedAt: string | null;
  takedownAt: string;
  takedownReason: string;
  takedownByHandle: string | null;
};

export type AdminPublishedComparison = {
  id: string;
  title: string;
  authorHandle: string;
  publishedAt: string | null;
};

export type AdminActionView = {
  id: string;
  action: AdminActionKind;
  actorHandle: string | null;
  targetType: AdminTargetType;
  targetId: string;
  targetLabel: string;
  reason: string | null;
  createdAt: string;
};

export type AdminReportView = {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  /** The Comparison an Admin opens to review a comment or annotation. */
  comparisonId: string | null;
  targetLabel: string;
  targetAuthorHandle: string;
  targetAuthorId: string | null;
  targetHidden: boolean;
  reporterHandle: string | null;
  reason: ReportReason;
  reasonLabel: string;
  detail: string | null;
  status: ReportStatus;
  createdAt: string;
  resolvedByHandle: string | null;
  resolvedAt: string | null;
  resolution: string | null;
};

export type AdminSuspendedUser = {
  id: string;
  handle: string;
  suspendedAt: string;
  suspensionReason: string;
  suspendedByHandle: string | null;
};

export type AdminOverview = {
  models: AdminModel[];
  publishedComparisons: AdminPublishedComparison[];
  hiddenComparisons: AdminHiddenComparison[];
  reports: AdminReportView[];
  suspendedUsers: AdminSuspendedUser[];
  recentActions: AdminActionView[];
};

/**
 * Admin operations are only reachable by the `admin` role. Missing and
 * non-admin actors look the same so the surface does not leak existence.
 */
export async function assertAdmin(actorId: string) {
  const [actor] = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);
  if (!actor || actor.role !== 'admin') throw notFound('Not found.');
  return actor;
}

export async function setModelEnabled(
  actorId: string,
  modelId: string,
  enabled: boolean,
): Promise<AdminModel> {
  await assertAdmin(actorId);
  const db = getDb();
  const [model] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
  if (!model) throw notFound('Model not found.');

  if (model.enabled !== enabled) {
    await db.transaction(async (tx) => {
      await tx.update(models).set({ enabled }).where(eq(models.id, modelId));
      await tx.insert(adminActions).values({
        id: uuidv7(),
        actorId,
        action: enabled ? 'model.enabled' : 'model.disabled',
        targetType: 'model',
        targetId: modelId,
      });
    });
  }

  const [usage] = await db
    .select({ total: count() })
    .from(responses)
    .where(eq(responses.modelId, modelId));

  return {
    id: model.id,
    slug: model.slug,
    displayName: model.displayName,
    monogram: model.monogram,
    provider: model.provider,
    etaSeconds: model.etaSeconds,
    enabled,
    responseCount: Number(usage?.total ?? 0),
  };
}

export function validateModerationReason(reason: string) {
  const text = reason.trim();
  if (!text) {
    throw new DomainError('reason_required', 'Say why this content is being removed.', 400);
  }
  if (text.length > 500) {
    throw new DomainError(
      'reason_too_long',
      'Keep the moderation reason under 500 characters.',
      400,
    );
  }
  return text;
}

export async function takeDownComparison(
  actorId: string,
  comparisonId: string,
  reason: string,
): Promise<void> {
  await assertAdmin(actorId);
  const reasonText = validateModerationReason(reason);

  const db = getDb();
  const [comparison] = await db
    .select()
    .from(comparisons)
    .where(
      and(
        eq(comparisons.id, comparisonId),
        eq(comparisons.status, 'published'),
        isNull(comparisons.deletedAt),
      ),
    )
    .limit(1);
  if (!comparison) throw notFound('Comparison not found.');
  if (comparison.takedownAt) {
    throw conflict('already_taken_down', 'That comparison is already hidden.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(comparisons)
      .set({
        takedownAt: new Date(),
        takedownById: actorId,
        takedownReason: reasonText,
      })
      .where(eq(comparisons.id, comparisonId));
    await tx.insert(adminActions).values({
      id: uuidv7(),
      actorId,
      action: 'comparison.takedown',
      targetType: 'comparison',
      targetId: comparisonId,
      reason: reasonText,
    });
    // Historical ticker rows would otherwise leak the title on a later Board
    // load or SSE replay. The summary-less event below is the only trace left
    // in the public stream.
    await tx
      .delete(activityEvents)
      .where(eq(activityEvents.comparisonId, comparisonId));
  });

  // The Board stream removes the card on this event. It carries no summary and
  // no actor, so it never appears in the public ticker or reveals who acted.
  await logActivity({
    kind: 'comparison.takedown',
    comparisonId,
    payload: { comparisonId },
  });
}

export async function restoreComparison(
  actorId: string,
  comparisonId: string,
  reason?: string | null,
): Promise<void> {
  await assertAdmin(actorId);
  const reasonText = reason?.trim() ? validateModerationReason(reason) : 'Takedown reversed';
  const db = getDb();
  const [comparison] = await db
    .select()
    .from(comparisons)
    .where(
      and(
        eq(comparisons.id, comparisonId),
        isNotNull(comparisons.takedownAt),
        isNull(comparisons.deletedAt),
      ),
    )
    .limit(1);
  if (!comparison) throw notFound('Comparison not found.');

  await db.transaction(async (tx) => {
    await tx
      .update(comparisons)
      .set({ takedownAt: null, takedownById: null, takedownReason: null })
      .where(eq(comparisons.id, comparisonId));
    await tx.insert(adminActions).values({
      id: uuidv7(),
      actorId,
      action: 'comparison.restored',
      targetType: 'comparison',
      targetId: comparisonId,
      reason: reasonText,
    });
  });

  // Restoring is a re-publish as far as the Board is concerned: the event
  // carries the settled card so a live reader can add it back.
  const card = await getCardById(comparisonId);
  await logActivity({
    kind: 'comparison.restored',
    comparisonId,
    payload: card ? { card } : { comparisonId },
  });
}

function shorten(value: string, limit = 120) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export async function getAdminOverview(actorId: string): Promise<AdminOverview> {
  await assertAdmin(actorId);
  const db = getDb();
  const author = alias(users, 'comparison_author');
  const takedownBy = alias(users, 'takedown_actor');
  const actor = alias(users, 'action_actor');
  const reporter = alias(users, 'report_reporter');
  const resolver = alias(users, 'report_resolver');
  const suspendedBy = alias(users, 'suspended_actor');

  const [modelRows, usageRows, publishedRows, hiddenRows, actionRows, openReportRows, closedReportRows, suspendedRows] =
    await Promise.all([
      db.select().from(models).orderBy(models.displayName),
      db
        .select({ modelId: responses.modelId, total: count() })
        .from(responses)
        .groupBy(responses.modelId),
      db
        .select({
          id: comparisons.id,
          title: comparisons.title,
          publishedAt: comparisons.publishedAt,
          authorHandle: author.handle,
        })
        .from(comparisons)
        .innerJoin(author, eq(author.id, comparisons.authorId))
        .where(
          and(
            eq(comparisons.status, 'published'),
            isNull(comparisons.deletedAt),
            isNull(comparisons.takedownAt),
          ),
        )
        .orderBy(desc(comparisons.publishedAt)),
      db
        .select({
          id: comparisons.id,
          title: comparisons.title,
          status: comparisons.status,
          publishedAt: comparisons.publishedAt,
          takedownAt: comparisons.takedownAt,
          takedownReason: comparisons.takedownReason,
          authorHandle: author.handle,
          takedownByHandle: takedownBy.handle,
        })
        .from(comparisons)
        .innerJoin(author, eq(author.id, comparisons.authorId))
        .leftJoin(takedownBy, eq(takedownBy.id, comparisons.takedownById))
        .where(isNotNull(comparisons.takedownAt))
        .orderBy(desc(comparisons.takedownAt)),
      db
        .select({ action: adminActions, actorHandle: actor.handle })
        .from(adminActions)
        .leftJoin(actor, eq(actor.id, adminActions.actorId))
        .orderBy(desc(adminActions.createdAt))
        .limit(50),
      db
        .select({
          report: reports,
          reporterHandle: reporter.handle,
          resolvedByHandle: resolver.handle,
        })
        .from(reports)
        .leftJoin(reporter, eq(reporter.id, reports.reporterId))
        .leftJoin(resolver, eq(resolver.id, reports.resolvedById))
        .where(eq(reports.status, 'open'))
        .orderBy(reports.createdAt)
        .limit(500),
      db
        .select({
          report: reports,
          reporterHandle: reporter.handle,
          resolvedByHandle: resolver.handle,
        })
        .from(reports)
        .leftJoin(reporter, eq(reporter.id, reports.reporterId))
        .leftJoin(resolver, eq(resolver.id, reports.resolvedById))
        .where(ne(reports.status, 'open'))
        .orderBy(desc(reports.createdAt))
        .limit(100),
      db
        .select({ user: users, suspendedByHandle: suspendedBy.handle })
        .from(users)
        .leftJoin(suspendedBy, eq(suspendedBy.id, users.suspendedById))
        .where(isNotNull(users.suspendedAt))
        .orderBy(desc(users.suspendedAt)),
    ]);

  // Every open report is in the queue; closed reports are the most recent 100.
  const reportRows = [...openReportRows, ...closedReportRows];

  const usage = new Map(usageRows.map((row) => [row.modelId, Number(row.total)]));
  const modelById = new Map(modelRows.map((row) => [row.id, row]));
  const hiddenById = new Map(hiddenRows.map((row) => [row.id, row]));

  const missingComparisonIds = [
    ...new Set(
      actionRows
        .filter(
          (row) =>
            row.action.targetType === 'comparison' &&
            !hiddenById.has(row.action.targetId),
        )
        .map((row) => row.action.targetId),
    ),
  ];
  const restoredComparisons = missingComparisonIds.length
    ? await db
        .select({ id: comparisons.id, title: comparisons.title })
        .from(comparisons)
        .where(inArray(comparisons.id, missingComparisonIds))
    : [];
  const restoredById = new Map(
    restoredComparisons.map((row) => [row.id, row.title]),
  );

  const targetIds = (type: ReportTarget) => [
    ...new Set(
      reportRows.filter((row) => row.report.targetType === type).map((row) => row.report.targetId),
    ),
  ];
  const commentIds = targetIds('comment');
  const annotationIds = targetIds('annotation');
  const comparisonIds = targetIds('comparison');

  const [comparisonTargets, commentTargets, annotationTargets] = await Promise.all([
    comparisonIds.length
      ? db
          .select({
            id: comparisons.id,
            title: comparisons.title,
            authorId: comparisons.authorId,
            takedownAt: comparisons.takedownAt,
          })
          .from(comparisons)
          .where(inArray(comparisons.id, comparisonIds))
      : Promise.resolve([]),
    commentIds.length
      ? db
          .select({
            id: comments.id,
            body: comments.body,
            authorId: comments.authorId,
            comparisonId: comments.comparisonId,
            hiddenAt: comments.hiddenAt,
          })
          .from(comments)
          .where(inArray(comments.id, commentIds))
      : Promise.resolve([]),
    annotationIds.length
      ? db
          .select({
            id: annotations.id,
            quote: annotations.quote,
            authorId: annotations.authorId,
            comparisonId: responses.comparisonId,
            hiddenAt: annotations.hiddenAt,
          })
          .from(annotations)
          .innerJoin(responses, eq(responses.id, annotations.responseId))
          .where(inArray(annotations.id, annotationIds))
      : Promise.resolve([]),
  ]);

  const targetAuthorIds = [
    ...new Set([
      ...comparisonTargets.map((row) => row.authorId),
      ...commentTargets.map((row) => row.authorId),
      ...annotationTargets.map((row) => row.authorId),
    ]),
  ];
  const targetAuthorRows = targetAuthorIds.length
    ? await db
        .select({ id: users.id, handle: users.handle })
        .from(users)
        .where(inArray(users.id, targetAuthorIds))
    : [];
  const targetAuthorById = new Map(
    targetAuthorRows.map((row) => [row.id, row.handle ?? 'unknown']),
  );

  const actionUserIds = [
    ...new Set(
      actionRows
        .filter((row) => row.action.targetType === 'user')
        .map((row) => row.action.targetId),
    ),
  ];
  const actionUserRows = actionUserIds.length
    ? await db
        .select({ id: users.id, handle: users.handle })
        .from(users)
        .where(inArray(users.id, actionUserIds))
    : [];
  const actionUserById = new Map(
    actionUserRows.map((row) => [row.id, row.handle ?? 'unknown']),
  );

  const comparisonTargetById = new Map(comparisonTargets.map((row) => [row.id, row]));
  const commentTargetById = new Map(commentTargets.map((row) => [row.id, row]));
  const annotationTargetById = new Map(annotationTargets.map((row) => [row.id, row]));

  const reportViews: AdminReportView[] = reportRows.map(
    ({ report, reporterHandle, resolvedByHandle }) => {
      let comparisonId: string | null = null;
      let targetLabel = 'Deleted content';
      let authorId: string | null = null;
      let hidden = true;

      if (report.targetType === 'comparison') {
        const target = comparisonTargetById.get(report.targetId);
        if (target) {
          comparisonId = target.id;
          targetLabel = target.title;
          authorId = target.authorId;
          hidden = target.takedownAt !== null;
        }
      } else if (report.targetType === 'comment') {
        const target = commentTargetById.get(report.targetId);
        if (target) {
          comparisonId = target.comparisonId;
          targetLabel = shorten(target.body);
          authorId = target.authorId;
          hidden = target.hiddenAt !== null;
        }
      } else {
        const target = annotationTargetById.get(report.targetId);
        if (target) {
          comparisonId = target.comparisonId;
          targetLabel = shorten(target.quote);
          authorId = target.authorId;
          hidden = target.hiddenAt !== null;
        }
      }

      return {
        id: report.id,
        targetType: report.targetType,
        targetId: report.targetId,
        comparisonId,
        targetLabel,
        targetAuthorHandle: authorId ? (targetAuthorById.get(authorId) ?? 'unknown') : 'unknown',
        targetAuthorId: authorId,
        targetHidden: hidden,
        reporterHandle,
        reason: report.reason,
        reasonLabel: REPORT_REASON_META[report.reason],
        detail: report.detail,
        status: report.status,
        createdAt: report.createdAt.toISOString(),
        resolvedByHandle,
        resolvedAt: report.resolvedAt?.toISOString() ?? null,
        resolution: report.resolution,
      };
    },
  );

  return {
    models: modelRows.map((model) => ({
      id: model.id,
      slug: model.slug,
      displayName: model.displayName,
      monogram: model.monogram,
      provider: model.provider,
      etaSeconds: model.etaSeconds,
      enabled: model.enabled,
      responseCount: usage.get(model.id) ?? 0,
    })),
    publishedComparisons: publishedRows.map((row) => ({
      id: row.id,
      title: row.title,
      authorHandle: row.authorHandle ?? 'unknown',
      publishedAt: row.publishedAt?.toISOString() ?? null,
    })),
    hiddenComparisons: hiddenRows.map((row) => ({
      id: row.id,
      title: row.title,
      authorHandle: row.authorHandle ?? 'unknown',
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      takedownAt: row.takedownAt!.toISOString(),
      takedownReason: row.takedownReason ?? '',
      takedownByHandle: row.takedownByHandle,
    })),
    reports: reportViews,
    suspendedUsers: suspendedRows.map(({ user, suspendedByHandle }) => ({
      id: user.id,
      handle: user.handle ?? 'unknown',
      suspendedAt: user.suspendedAt!.toISOString(),
      suspensionReason: user.suspensionReason ?? '',
      suspendedByHandle,
    })),
    recentActions: actionRows.map(({ action: row, actorHandle }) => ({
      id: row.id,
      action: row.action,
      actorHandle,
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: actionTargetLabel(row, {
        modelById,
        hiddenById,
        restoredById,
        comparisonTargetById,
        commentTargetById,
        annotationTargetById,
        actionUserById,
      }),
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

function actionTargetLabel(
  row: { targetType: AdminTargetType; targetId: string },
  maps: {
    modelById: Map<string, { displayName: string }>;
    hiddenById: Map<string, { title: string }>;
    restoredById: Map<string, string>;
    comparisonTargetById: Map<string, { title: string }>;
    commentTargetById: Map<string, { body: string }>;
    annotationTargetById: Map<string, { quote: string }>;
    actionUserById: Map<string, string>;
  },
): string {
  switch (row.targetType) {
    case 'model':
      return maps.modelById.get(row.targetId)?.displayName ?? 'Unknown model';
    case 'comparison':
      return (
        maps.hiddenById.get(row.targetId)?.title ??
        maps.restoredById.get(row.targetId) ??
        maps.comparisonTargetById.get(row.targetId)?.title ??
        'Comparison'
      );
    case 'comment':
      return maps.commentTargetById.get(row.targetId)
        ? `Comment: ${shorten(maps.commentTargetById.get(row.targetId)!.body, 60)}`
        : 'Comment';
    case 'annotation':
      return maps.annotationTargetById.get(row.targetId)
        ? `Annotation: ${shorten(maps.annotationTargetById.get(row.targetId)!.quote, 60)}`
        : 'Annotation';
    case 'user':
      return maps.actionUserById.get(row.targetId)
        ? `@${maps.actionUserById.get(row.targetId)}`
        : 'Member account';
    case 'report':
      return 'Report';
  }
}

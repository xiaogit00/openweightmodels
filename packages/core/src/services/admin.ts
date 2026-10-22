import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../db/client';
import {
  activityEvents,
  adminActions,
  comparisons,
  models,
  responses,
  users,
} from '../db/schema';
import type { AdminActionKind, ComparisonStatus } from '../domain/types';
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
  targetType: 'model' | 'comparison';
  targetId: string;
  targetLabel: string;
  reason: string | null;
  createdAt: string;
};

export type AdminOverview = {
  models: AdminModel[];
  publishedComparisons: AdminPublishedComparison[];
  hiddenComparisons: AdminHiddenComparison[];
  recentActions: AdminActionView[];
};

/**
 * Admin operations are only reachable by the `admin` role. Missing and
 * non-admin actors look the same so the surface does not leak existence.
 */
async function assertAdmin(actorId: string) {
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

function takedownReason(reason: string) {
  const text = reason.trim();
  if (!text) {
    throw new DomainError('reason_required', 'Say why this comparison is hidden.', 400);
  }
  if (text.length > 500) {
    throw new DomainError(
      'reason_too_long',
      'Keep the takedown reason under 500 characters.',
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
  const reasonText = takedownReason(reason);

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
): Promise<void> {
  await assertAdmin(actorId);
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

export async function getAdminOverview(actorId: string): Promise<AdminOverview> {
  await assertAdmin(actorId);
  const db = getDb();
  const author = alias(users, 'comparison_author');
  const takedownBy = alias(users, 'takedown_actor');
  const actor = alias(users, 'action_actor');

  const [modelRows, usageRows, publishedRows, hiddenRows, actionRows] =
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
    ]);

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
    recentActions: actionRows.map(({ action: row, actorHandle }) => ({
      id: row.id,
      action: row.action,
      actorHandle,
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel:
        row.targetType === 'model'
          ? (modelById.get(row.targetId)?.displayName ?? 'Unknown model')
          : (hiddenById.get(row.targetId)?.title ??
            restoredById.get(row.targetId) ??
            'Comparison'),
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

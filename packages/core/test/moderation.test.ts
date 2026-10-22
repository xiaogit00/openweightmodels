import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  activityAfter,
  addAnnotationMessage,
  closeDb,
  closeRedis,
  createAnnotation,
  createComment,
  createComparison,
  createReport,
  DomainError,
  getAdminOverview,
  getAnnotationViews,
  getCommentViews,
  getComparisonForViewer,
  getComparisonRow,
  getDb,
  hideReportedContent,
  dismissReport,
  reinstateUser,
  REPORT_REASON_META,
  reports,
  restoreModeratedContent,
  suspendUser,
  toggleVote,
  updateComment,
} from '../src/index';
import { createJobFixture, createUserFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; moderation tests skipped');
}

afterAll(async () => {
  await closeRedis();
  await closeDb();
});

async function errorCode(action: () => Promise<unknown>) {
  try {
    await action();
    return null;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
}

describe.skipIf(!available)('reports', () => {
  it('records one report per reader per target and ignores repeats', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const reader = await createUserFixture();

    try {
      const first = await createReport({
        reporterId: reader.id,
        targetType: 'comparison',
        targetId: fixture.comparisonId,
        reason: 'spam',
        detail: 'Promotes a paid tool in every answer.',
      });
      expect(first).toMatchObject({ status: 'open', duplicate: false });

      const again = await createReport({
        reporterId: reader.id,
        targetType: 'comparison',
        targetId: fixture.comparisonId,
        reason: 'misinformation',
        detail: 'Reporting it twice should not create noise.',
      });
      expect(again).toMatchObject({ id: first.id, duplicate: true });

      const rows = await getDb()
        .select()
        .from(reports)
        .where(eq(reports.targetId, fixture.comparisonId));
      expect(rows).toHaveLength(1);
    } finally {
      await fixture.cleanup();
      await reader.cleanup();
    }
  });

  it('rejects reporting your own content', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });

    try {
      expect(
        await errorCode(() =>
          createReport({
            reporterId: fixture.userId,
            targetType: 'comparison',
            targetId: fixture.comparisonId,
            reason: 'spam',
          }),
        ),
      ).toBe('own_content');
    } finally {
      await fixture.cleanup();
    }
  });
});

describe.skipIf(!available)('hiding reported content', () => {
  it('hides a reported comment from readers, counts and the ticker, then restores it', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const reader = await createUserFixture();
    const admin = await createUserFixture({ role: 'admin' });

    try {
      const comment = await createComment({
        userId: fixture.userId,
        comparisonId: fixture.comparisonId,
        body: 'A comment that will be moderated away.',
      });
      const reply = await createComment({
        userId: reader.id,
        comparisonId: fixture.comparisonId,
        parentId: comment.id,
        body: 'A reply that must disappear with its parent.',
      });
      const report = await createReport({
        reporterId: reader.id,
        targetType: 'comment',
        targetId: comment.id,
        reason: 'harassment',
      });
      expect((await getComparisonRow(fixture.comparisonId))?.commentCount).toBe(2);

      await hideReportedContent(admin.id, report.id, 'Targets another reader');

      expect(
        (await getCommentViews(fixture.comparisonId, null)).some(
          (row) => row.id === comment.id,
        ),
      ).toBe(false);
      expect((await getComparisonRow(fixture.comparisonId))?.commentCount).toBe(0);

      const overview = await getAdminOverview(admin.id);
      expect(overview.reports.find((row) => row.id === report.id)).toMatchObject({
        status: 'resolved',
        targetHidden: true,
        resolvedByHandle: admin.handle,
        resolution: 'Targets another reader',
      });
      expect(overview.recentActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'comment.hidden',
            targetType: 'comment',
            targetId: comment.id,
            actorHandle: admin.handle,
            reason: 'Targets another reader',
          }),
          expect.objectContaining({
            action: 'report.resolved',
            targetType: 'report',
            targetId: report.id,
            actorHandle: admin.handle,
          }),
        ]),
      );

      const events = await activityAfter(0, 500);
      expect(
        events.filter(
          (event) =>
            event.comparisonId === fixture.comparisonId &&
            (event.payload.commentId === comment.id ||
              event.payload.commentId === reply.id) &&
            event.summary !== '',
        ),
      ).toEqual([]);
      expect(
        events.some(
          (event) => event.comparisonId === fixture.comparisonId && event.kind === 'comment.hidden',
        ),
      ).toBe(true);
      expect(
        events.find(
          (event) =>
            event.comparisonId === fixture.comparisonId && event.kind === 'comment.hidden',
        )?.payload,
      ).toMatchObject({ commentId: comment.id, hiddenCount: 2 });
      expect(
        await errorCode(() =>
          createComment({
            userId: reader.id,
            comparisonId: fixture.comparisonId,
            parentId: comment.id,
            body: 'Replying to hidden content should fail.',
          }),
        ),
      ).toBe('not_found');
      expect(await errorCode(() => toggleVote(reader.id, 'comment', comment.id))).toBe(
        'not_found',
      );
      // A reply follows its hidden parent: vote, report and edit all see 404.
      expect(await errorCode(() => toggleVote(reader.id, 'comment', reply.id))).toBe(
        'not_found',
      );
      expect(
        await errorCode(() =>
          createReport({
            reporterId: admin.id,
            targetType: 'comment',
            targetId: reply.id,
            reason: 'spam',
          }),
        ),
      ).toBe('not_found');
      expect(await errorCode(() => updateComment(reply.id, reader.id, 'Edited reply'))).toBe(
        'not_found',
      );

      await restoreModeratedContent(admin.id, 'comment', comment.id);

      expect(
        (await getCommentViews(fixture.comparisonId, null)).some(
          (row) => row.id === comment.id,
        ),
      ).toBe(true);
      expect((await getComparisonRow(fixture.comparisonId))?.commentCount).toBe(2);
      expect((await getAdminOverview(admin.id)).recentActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'comment.restored',
            targetType: 'comment',
            targetId: comment.id,
            actorHandle: admin.handle,
            reason: 'Restored after review',
          }),
        ]),
      );
    } finally {
      await fixture.cleanup();
      await reader.cleanup();
      await admin.cleanup();
    }
  });

  it('hides a reported annotation and its thread, then restores it', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const reader = await createUserFixture();
    const admin = await createUserFixture({ role: 'admin' });

    try {
      const annotation = await createAnnotation({
        userId: fixture.userId,
        responseId: fixture.baseResponseId,
        kind: 'bug',
        startOffset: 0,
        endOffset: 13,
        body: 'This claim is wrong.',
      });
      const report = await createReport({
        reporterId: reader.id,
        targetType: 'annotation',
        targetId: annotation.id,
        reason: 'misinformation',
      });
      expect((await getComparisonRow(fixture.comparisonId))?.annotationCount).toBe(1);

      await hideReportedContent(admin.id, report.id, 'Unsupported claim');

      expect(
        (await getAnnotationViews(fixture.comparisonId, null)).some(
          (row) => row.id === annotation.id,
        ),
      ).toBe(false);
      expect((await getComparisonRow(fixture.comparisonId))?.annotationCount).toBe(0);
      expect(
        await errorCode(() =>
          addAnnotationMessage(annotation.id, reader.id, 'Replying to hidden content.'),
        ),
      ).toBe('not_found');
      expect(await errorCode(() => toggleVote(reader.id, 'annotation', annotation.id))).toBe(
        'not_found',
      );
      expect((await getAdminOverview(admin.id)).recentActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'annotation.hidden',
            targetType: 'annotation',
            targetId: annotation.id,
          }),
        ]),
      );

      await restoreModeratedContent(admin.id, 'annotation', annotation.id);

      expect(
        (await getAnnotationViews(fixture.comparisonId, null)).some(
          (row) => row.id === annotation.id,
        ),
      ).toBe(true);
      expect((await getComparisonRow(fixture.comparisonId))?.annotationCount).toBe(1);
    } finally {
      await fixture.cleanup();
      await reader.cleanup();
      await admin.cleanup();
    }
  });
});

describe.skipIf(!available)('suspension', () => {
  it('lets a suspended member read but rejects every write until reinstated', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const other = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const admin = await createUserFixture({ role: 'admin' });
    const author = fixture.userId;

    try {
      const comment = await createComment({
        userId: author,
        comparisonId: fixture.comparisonId,
        body: 'Written before the suspension.',
      });
      const foreignComment = await createComment({
        userId: other.userId,
        comparisonId: other.comparisonId,
        body: 'Someone else owns this comment.',
      });

      expect(await errorCode(() => suspendUser(author, author, 'Self-suspension'))).toBe(
        'not_found',
      );
      await suspendUser(admin.id, author, 'Repeated harassment');

      expect((await getComparisonForViewer(fixture.comparisonId, null))?.comparison.id).toBe(
        fixture.comparisonId,
      );
      expect(
        (await getCommentViews(fixture.comparisonId, null)).some(
          (row) => row.id === comment.id,
        ),
      ).toBe(true);

      const overview = await getAdminOverview(admin.id);
      expect(overview.suspendedUsers).toContainEqual(
        expect.objectContaining({
          id: author,
          handle: fixture.handle,
          suspensionReason: 'Repeated harassment',
          suspendedByHandle: admin.handle,
        }),
      );
      expect(overview.recentActions).toContainEqual(
        expect.objectContaining({
          action: 'user.suspended',
          targetType: 'user',
          targetId: author,
          actorHandle: admin.handle,
          reason: 'Repeated harassment',
        }),
      );

      expect(
        await errorCode(() =>
          createComment({
            userId: author,
            comparisonId: fixture.comparisonId,
            body: 'Blocked while suspended.',
          }),
        ),
      ).toBe('account_suspended');
      expect(await errorCode(() => updateComment(comment.id, author, 'Edited'))).toBe(
        'account_suspended',
      );
      expect(
        await errorCode(() =>
          createAnnotation({
            userId: author,
            responseId: fixture.baseResponseId,
            kind: 'bug',
            startOffset: 0,
            endOffset: 5,
            body: 'Blocked while suspended.',
          }),
        ),
      ).toBe('account_suspended');
      expect(
        await errorCode(() => toggleVote(author, 'comment', foreignComment.id)),
      ).toBe('account_suspended');
      expect(
        await errorCode(() =>
          createReport({
            reporterId: author,
            targetType: 'comparison',
            targetId: other.comparisonId,
            reason: 'spam',
          }),
        ),
      ).toBe('account_suspended');
      expect(
        await errorCode(() =>
          createComparison({
            authorId: author,
            fileName: 'suspended.md',
            fileText: 'A base answer.',
            baseModelId: fixture.baseModelId,
            prompt: 'A prompt.',
            modelIds: [fixture.challengerModelIds[0]!],
            title: 'Blocked while suspended',
            categories: ['Coding'],
            effort: 1,
          }),
        ),
      ).toBe('account_suspended');

      await reinstateUser(admin.id, author);
      expect(
        await createComment({
          userId: author,
          comparisonId: fixture.comparisonId,
          body: 'Back after reinstatement.',
        }),
      ).toMatchObject({ body: 'Back after reinstatement.' });
      expect((await getAdminOverview(admin.id)).suspendedUsers).toEqual([]);
      expect((await getAdminOverview(admin.id)).recentActions).toContainEqual(
        expect.objectContaining({
          action: 'user.reinstated',
          targetId: author,
          reason: 'Suspension lifted',
        }),
      );
    } finally {
      await fixture.cleanup();
      await other.cleanup();
      await admin.cleanup();
    }
  });
});

describe.skipIf(!available)('moderation queue', () => {
  it('shows reports and their targets to admins only', async () => {
    const fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const reader = await createUserFixture();
    const admin = await createUserFixture({ role: 'admin' });

    try {
      const comment = await createComment({
        userId: fixture.userId,
        comparisonId: fixture.comparisonId,
        body: 'A reported comment that an Admin needs to review.',
      });
      const report = await createReport({
        reporterId: reader.id,
        targetType: 'comment',
        targetId: comment.id,
        reason: 'harassment',
        detail: 'It targets another reader.',
      });

      expect(await errorCode(() => getAdminOverview(reader.id))).toBe('not_found');

      const overview = await getAdminOverview(admin.id);
      expect(overview.reports).toContainEqual(
        expect.objectContaining({
          id: report.id,
          targetType: 'comment',
          targetId: comment.id,
          comparisonId: fixture.comparisonId,
          targetLabel: 'A reported comment that an Admin needs to review.',
          targetAuthorHandle: fixture.handle,
          targetHidden: false,
          reporterHandle: reader.handle,
          reason: 'harassment',
          reasonLabel: REPORT_REASON_META.harassment,
          detail: 'It targets another reader.',
          status: 'open',
        }),
      );

      expect(await errorCode(() => hideReportedContent(reader.id, report.id, 'Nope'))).toBe(
        'not_found',
      );
      expect(await errorCode(() => dismissReport(reader.id, report.id))).toBe('not_found');

      await dismissReport(admin.id, report.id, 'No rule was broken');
      expect((await getAdminOverview(admin.id)).reports.find((row) => row.id === report.id)).toMatchObject(
        {
          status: 'dismissed',
          resolution: 'No rule was broken',
          resolvedByHandle: admin.handle,
        },
      );
      expect((await getAdminOverview(admin.id)).recentActions).toContainEqual(
        expect.objectContaining({
          action: 'report.dismissed',
          targetType: 'report',
          targetId: report.id,
          reason: 'No rule was broken',
        }),
      );
      expect(
        (await getCommentViews(fixture.comparisonId, null)).some(
          (row) => row.id === comment.id,
        ),
      ).toBe(true);
    } finally {
      await fixture.cleanup();
      await reader.cleanup();
      await admin.cleanup();
    }
  });
});

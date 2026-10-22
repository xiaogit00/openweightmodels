import { afterAll, describe, expect, it } from 'vitest';
import {
  activityAfter,
  addAnnotationMessage,
  closeDb,
  closeRedis,
  createAnnotation,
  createComment,
  deleteAnnotation,
  deleteAnnotationMessage,
  deleteComment,
  DomainError,
  getAnnotationViews,
  getCardById,
  getCommentViews,
  getComparisonRow,
  toggleVote,
  updateAnnotation,
  updateAnnotationMessage,
  updateComment,
} from '../src/index';
import { createJobFixture, createUserFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; edit/delete tests skipped');
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

type Fixture = Awaited<ReturnType<typeof createJobFixture>>;

async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const fixture = await createJobFixture({ comparisonStatus: 'published' });
  try {
    await run(fixture);
  } finally {
    await fixture.cleanup();
  }
}

describe.skipIf(!available)('Discussion edits and deletes', () => {
  it('edits a comment in place and preserves its author and model attribution', async () => {
    await withFixture(async (fixture) => {
      const comment = await createComment({
        userId: fixture.userId,
        comparisonId: fixture.comparisonId,
        aboutModelId: fixture.baseModelId,
        body: '  The original comment.  ',
      });

      await updateComment(comment.id, fixture.userId, '  The corrected comment.  ');

      const views = await getCommentViews(fixture.comparisonId, fixture.userId);
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({
        id: comment.id,
        body: 'The corrected comment.',
        deletedAt: null,
        author: { id: fixture.userId, handle: fixture.handle },
        aboutModel: { slug: fixture.baseModelSlug, name: expect.any(String) },
        replies: [],
      });
    });
  });

  it('rejects an empty or oversized edited comment body', async () => {
    await withFixture(async (fixture) => {
      const comment = await createComment({
        userId: fixture.userId,
        comparisonId: fixture.comparisonId,
        body: 'Valid to start.',
      });

      expect(await errorCode(() => updateComment(comment.id, fixture.userId, '   '))).toBe(
        'body_required',
      );
      expect(
        await errorCode(() => updateComment(comment.id, fixture.userId, 'x'.repeat(5001))),
      ).toBe('body_too_long');
    });
  });

  it('hard-deletes a childless comment, its votes, and the public count', async () => {
    await withFixture(async (fixture) => {
      const reader = await createUserFixture();
      try {
        const comment = await createComment({
          userId: fixture.userId,
          comparisonId: fixture.comparisonId,
          body: 'No replies yet.',
        });
        expect(await toggleVote(reader.id, 'comment', comment.id)).toEqual({
          voted: true,
          count: 1,
        });
        expect((await getComparisonRow(fixture.comparisonId))?.commentCount).toBe(1);

        await deleteComment(comment.id, fixture.userId);

        expect(await getCommentViews(fixture.comparisonId, fixture.userId)).toEqual([]);
        expect((await getComparisonRow(fixture.comparisonId))?.commentCount).toBe(0);
        expect(await errorCode(() => toggleVote(reader.id, 'comment', comment.id))).toBe(
          'not_found',
        );
        expect((await getCardById(fixture.comparisonId))?.commentCount).toBe(0);
        const events = await activityAfter(0, 500);
        expect(
          events.some(
            (event) =>
              event.kind !== 'comment.deleted' && event.payload.commentId === comment.id,
          ),
        ).toBe(false);
        expect(
          events.some(
            (event) =>
              event.kind === 'comment.deleted' && event.payload.commentId === comment.id,
          ),
        ).toBe(true);
      } finally {
        await reader.cleanup();
      }
    });
  });

  it('tombstones a comment with replies and keeps reply attribution', async () => {
    await withFixture(async (fixture) => {
      const reader = await createUserFixture();
      try {
        const root = await createComment({
          userId: fixture.userId,
          comparisonId: fixture.comparisonId,
          body: 'The root comment.',
        });
        const reply = await createComment({
          userId: reader.id,
          comparisonId: fixture.comparisonId,
          parentId: root.id,
          body: 'The reply that must survive.',
        });
        expect((await getComparisonRow(fixture.comparisonId))?.commentCount).toBe(2);

        await deleteComment(root.id, fixture.userId);

        const views = await getCommentViews(fixture.comparisonId, fixture.userId);
        expect(views).toHaveLength(1);
        expect(views[0]?.id).toBe(root.id);
        expect(views[0]?.body).toBe('');
        expect(views[0]?.deletedAt).toEqual(expect.any(String));
        expect(views[0]?.author.id).toBe(fixture.userId);
        expect(views[0]?.replies).toHaveLength(1);
        expect(views[0]?.replies[0]).toMatchObject({
          id: reply.id,
          body: 'The reply that must survive.',
          deletedAt: null,
          author: { id: reader.id, handle: reader.handle },
        });
        expect((await getComparisonRow(fixture.comparisonId))?.commentCount).toBe(1);
        expect((await getCardById(fixture.comparisonId))?.commentCount).toBe(1);
        expect(await errorCode(() => toggleVote(reader.id, 'comment', root.id))).toBe(
          'not_found',
        );
        const events = await activityAfter(0, 500);
        expect(
          events.some(
            (event) =>
              event.kind !== 'comment.deleted' && event.payload.commentId === root.id,
          ),
        ).toBe(false);
        expect(
          events.some(
            (event) =>
              event.kind !== 'comment.deleted' && event.payload.commentId === reply.id,
          ),
        ).toBe(true);
      } finally {
        await reader.cleanup();
      }
    });
  });
});

describe.skipIf(!available)('Annotation edits and deletes', () => {
  it('changes an Annotation kind and exposes the new kind to readers', async () => {
    await withFixture(async (fixture) => {
      const annotation = await createAnnotation({
        userId: fixture.userId,
        responseId: fixture.baseResponseId,
        kind: 'bug',
        startOffset: 2,
        endOffset: 6,
        body: 'The original annotation.',
      });

      await updateAnnotation(annotation.id, fixture.userId, 'good');

      const views = await getAnnotationViews(fixture.comparisonId, fixture.userId);
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({ id: annotation.id, kind: 'good', quote: 'base' });
    });
  });

  it('edits a thread message and tombstones a deleted one', async () => {
    await withFixture(async (fixture) => {
      const annotation = await createAnnotation({
        userId: fixture.userId,
        responseId: fixture.baseResponseId,
        kind: 'bug',
        startOffset: 2,
        endOffset: 6,
        body: 'First message.',
      });
      const messageId = annotation.thread[0]!.id;

      await updateAnnotationMessage(
        annotation.id,
        messageId,
        fixture.userId,
        'Edited message.',
      );
      let views = await getAnnotationViews(fixture.comparisonId, fixture.userId);
      expect(views[0]?.thread.map((message) => message.body)).toEqual(['Edited message.']);

      await deleteAnnotationMessage(annotation.id, messageId, fixture.userId);

      views = await getAnnotationViews(fixture.comparisonId, fixture.userId);
      expect(views).toHaveLength(1);
      expect(views[0]?.thread).toHaveLength(1);
      expect(views[0]?.thread[0]).toMatchObject({
        id: messageId,
        body: '',
        deletedAt: expect.any(String),
        author: { id: fixture.userId, handle: fixture.handle },
      });

      const events = await activityAfter(0, 500);
      expect(
        events.some(
          (event) =>
            event.kind !== 'annotation.message.deleted' &&
            event.payload.messageId === messageId,
        ),
      ).toBe(false);
      expect(
        events.some(
          (event) =>
            event.kind === 'annotation.message.deleted' &&
            event.payload.messageId === messageId,
        ),
      ).toBe(true);
    });
  });

  it('removes a deleted Annotation, its thread and the public count', async () => {
    await withFixture(async (fixture) => {
      const reader = await createUserFixture();
      try {
        const annotation = await createAnnotation({
          userId: fixture.userId,
          responseId: fixture.baseResponseId,
          kind: 'question',
          startOffset: 2,
          endOffset: 6,
          body: 'A question.',
        });
        await addAnnotationMessage(annotation.id, reader.id, 'A reply.');
        expect(await toggleVote(reader.id, 'annotation', annotation.id)).toEqual({
          voted: true,
          count: 1,
        });
        expect((await getComparisonRow(fixture.comparisonId))?.annotationCount).toBe(1);

        await deleteAnnotation(annotation.id, fixture.userId);

        expect(await getAnnotationViews(fixture.comparisonId, fixture.userId)).toEqual([]);
        expect((await getComparisonRow(fixture.comparisonId))?.annotationCount).toBe(0);
        expect((await getCardById(fixture.comparisonId))?.annotationCount).toBe(0);
        expect(
          await errorCode(() => toggleVote(reader.id, 'annotation', annotation.id)),
        ).toBe('not_found');
        const events = await activityAfter(0, 500);
        expect(
          events.some(
            (event) =>
              event.kind !== 'annotation.deleted' &&
              event.payload.annotationId === annotation.id,
          ),
        ).toBe(false);
      } finally {
        await reader.cleanup();
      }
    });
  });
});

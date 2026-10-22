import { afterAll, describe, expect, it } from 'vitest';
import {
  addAnnotationMessage,
  addModelToComparison,
  closeDb,
  closeRedis,
  createAnnotation,
  createComment,
  deleteAnnotation,
  deleteAnnotationMessage,
  deleteComment,
  DomainError,
  publishComparison,
  retryRun,
  skipRun,
  softDeleteComparison,
  toggleVote,
  unpublishComparison,
  updateAnnotation,
  updateAnnotationMessage,
  updateComment,
  updateComparison,
} from '../src/index';
import {
  createJobFixture,
  createUserFixture,
  servicesAvailable,
  type FixtureOptions,
} from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; permission tests skipped');
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
type Stranger = Awaited<ReturnType<typeof createUserFixture>>;

async function withFixture(
  options: FixtureOptions,
  run: (fixture: Fixture, stranger: Stranger) => Promise<void>,
) {
  const fixture = await createJobFixture(options);
  const stranger = await createUserFixture();
  try {
    await run(fixture, stranger);
  } finally {
    await fixture.cleanup();
    await stranger.cleanup();
  }
}

describe.skipIf(!available)('author-only writes', () => {
  it('refuses to publish, edit, unpublish or delete another author’s Comparison', async () => {
    await withFixture(
      { comparisonStatus: 'published', runStatus: 'done' },
      async (fixture, stranger) => {
        expect(
          await errorCode(() => publishComparison(fixture.comparisonId, stranger.id)),
        ).toBe('forbidden');
        expect(
          await errorCode(() =>
            updateComparison(fixture.comparisonId, stranger.id, { title: 'Hijacked' }),
          ),
        ).toBe('forbidden');
        expect(
          await errorCode(() => unpublishComparison(fixture.comparisonId, stranger.id)),
        ).toBe('forbidden');
        expect(
          await errorCode(() => softDeleteComparison(fixture.comparisonId, stranger.id)),
        ).toBe('forbidden');
      },
    );
  });

  it('refuses to retry or skip another author’s Run', async () => {
    await withFixture({ runStatus: 'failed' }, async (fixture, stranger) => {
      expect(await errorCode(() => retryRun(fixture.runIds[0]!, stranger.id))).toBe(
        'forbidden',
      );
      expect(await errorCode(() => skipRun(fixture.runIds[0]!, stranger.id))).toBe(
        'forbidden',
      );
    });
  });

  it('refuses to add a Challenger to another author’s Comparison', async () => {
    await withFixture({}, async (fixture, stranger) => {
      expect(
        await errorCode(() =>
          addModelToComparison(
            fixture.comparisonId,
            fixture.challengerModelIds[0]!,
            stranger.id,
          ),
        ),
      ).toBe('forbidden');
    });
  });

  it('refuses to edit or delete another author’s Discussion comment', async () => {
    await withFixture({ comparisonStatus: 'published' }, async (fixture, stranger) => {
      const comment = await createComment({
        userId: fixture.userId,
        comparisonId: fixture.comparisonId,
        body: 'The original comment.',
      });

      expect(
        await errorCode(() => updateComment(comment.id, stranger.id, 'Hijacked')),
      ).toBe('forbidden');
      expect(await errorCode(() => deleteComment(comment.id, stranger.id))).toBe(
        'forbidden',
      );
    });
  });

  it('refuses to edit or delete another author’s Annotation and thread message', async () => {
    await withFixture({ comparisonStatus: 'published' }, async (fixture, stranger) => {
      const annotation = await createAnnotation({
        userId: fixture.userId,
        responseId: fixture.baseResponseId,
        kind: 'bug',
        startOffset: 2,
        endOffset: 6,
        body: 'The original annotation.',
      });
      const messageId = annotation.thread[0]!.id;

      expect(
        await errorCode(() => updateAnnotation(annotation.id, stranger.id, 'good')),
      ).toBe('forbidden');
      expect(await errorCode(() => deleteAnnotation(annotation.id, stranger.id))).toBe(
        'forbidden',
      );
      expect(
        await errorCode(() =>
          updateAnnotationMessage(annotation.id, messageId, stranger.id, 'x'),
        ),
      ).toBe('forbidden');
      expect(
        await errorCode(() =>
          deleteAnnotationMessage(annotation.id, messageId, stranger.id),
        ),
      ).toBe('forbidden');
    });
  });
});

describe.skipIf(!available)('draft visibility', () => {
  it('hides annotation and Discussion writes on another author’s draft', async () => {
    await withFixture({ comparisonStatus: 'generating' }, async (fixture, stranger) => {
      const annotation = await createAnnotation({
        userId: fixture.userId,
        responseId: fixture.baseResponseId,
        kind: 'good',
        startOffset: 0,
        endOffset: 4,
        body: 'Author-only note while generating.',
      });

      expect(
        await errorCode(() =>
          createAnnotation({
            userId: stranger.id,
            responseId: fixture.baseResponseId,
            kind: 'bug',
            startOffset: 7,
            endOffset: 11,
            body: 'Should not reach a draft.',
          }),
        ),
      ).toBe('not_found');

      expect(
        await errorCode(() =>
          createComment({
            userId: stranger.id,
            comparisonId: fixture.comparisonId,
            body: 'Should not reach a draft.',
          }),
        ),
      ).toBe('not_found');

      expect(
        await errorCode(() =>
          addAnnotationMessage(annotation.id, stranger.id, 'Should not reach a draft.'),
        ),
      ).toBe('not_found');
    });
  });

  it('lets any signed-in viewer write on a published Comparison', async () => {
    await withFixture({ comparisonStatus: 'published' }, async (fixture, stranger) => {
      const comment = await createComment({
        userId: stranger.id,
        comparisonId: fixture.comparisonId,
        body: 'A reader comment.',
      });
      expect(comment.body).toBe('A reader comment.');

      const annotation = await createAnnotation({
        userId: stranger.id,
        responseId: fixture.baseResponseId,
        kind: 'question',
        startOffset: 7,
        endOffset: 13,
        body: 'A reader annotation.',
      });
      expect(annotation.quote).toBe('answer');
    });
  });
});

describe.skipIf(!available)('votes', () => {
  it('rejects a self-vote and toggles another user’s vote', async () => {
    await withFixture({ comparisonStatus: 'published' }, async (fixture, stranger) => {
      const comment = await createComment({
        userId: fixture.userId,
        comparisonId: fixture.comparisonId,
        body: 'Vote on this.',
      });

      expect(
        await errorCode(() => toggleVote(fixture.userId, 'comment', comment.id)),
      ).toBe('self_vote');
      expect(await toggleVote(stranger.id, 'comment', comment.id)).toEqual({
        voted: true,
        count: 1,
      });
      expect(await toggleVote(stranger.id, 'comment', comment.id)).toEqual({
        voted: false,
        count: 0,
      });
    });
  });
});

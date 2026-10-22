import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  activityEvents,
  addAnnotationMessage,
  annotationMessages,
  authAccounts,
  authSessions,
  authVerifications,
  closeDb,
  closeRedis,
  createAnnotation,
  createComment,
  createReport,
  DELETED_AUTHOR_HANDLE,
  deleteAccount,
  DomainError,
  exportAccountData,
  getAnnotationViews,
  getCommentViews,
  getComparisonForViewer,
  getComparisonRow,
  getDb,
  getUserByHandle,
  getUserById,
  hideReportedContent,
  notifications,
  setHandle,
  toggleVote,
  users,
  votes,
} from '../src/index';
import { createJobFixture, createUserFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; account tests skipped');
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

describe.skipIf(!available)('account deletion', () => {
  it('keeps published work under a deleted attribution, erases the account and tombstones its discussion', async () => {
    const db = getDb();
    const email = `departing-${uuidv7()}@example.test`;
    const author = await createUserFixture({ email });
    const handle = author.handle as string;
    const published = await createJobFixture({
      authorId: author.id,
      authorHandle: handle,
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const unpublished = await createJobFixture({
      authorId: author.id,
      authorHandle: handle,
      comparisonStatus: 'ready',
      runStatus: 'done',
    });
    const other: Fixture = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const reader = await createUserFixture();

    try {
      // The account's own Discussion comment, with a reply from someone else.
      const authorComment = await createComment({
        userId: author.id,
        comparisonId: other.comparisonId,
        body: 'An opinion from the departing account.',
      });
      const readerReply = await createComment({
        userId: reader.id,
        comparisonId: other.comparisonId,
        parentId: authorComment.id,
        body: 'A reply that must survive.',
      });
      await toggleVote(reader.id, 'comment', authorComment.id);
      await toggleVote(author.id, 'comment', readerReply.id);

      // Its Annotation, with a thread message from someone else.
      const annotation = await createAnnotation({
        userId: author.id,
        responseId: other.baseResponseId,
        kind: 'bug',
        startOffset: 0,
        endOffset: 4,
        body: 'Thread opener from the departing account.',
      });
      await addAnnotationMessage(
        annotation.id,
        reader.id,
        'Thread reply that must survive.',
      );

      // Sign-in identity and in-app state the account alone owns.
      await db.insert(notifications).values({
        id: uuidv7(),
        userId: author.id,
        kind: 'job.ready',
        payload: { jobId: published.jobId, comparisonId: published.comparisonId },
      });
      await db.insert(authSessions).values({
        id: uuidv7(),
        userId: author.id,
        token: `session-${uuidv7()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await db.insert(authAccounts).values({
        id: uuidv7(),
        userId: author.id,
        accountId: email,
        providerId: 'magic-link',
      });
      await db.insert(authVerifications).values({
        id: uuidv7(),
        identifier: `magic-link:${uuidv7()}`,
        value: JSON.stringify({ type: 'magic-link', email }),
        expiresAt: new Date(Date.now() + 900_000),
      });

      await deleteAccount(author.id, 'delete');

      // The account is gone as a sign-in identity but its row remains as the
      // anonymous attribution for published work.
      const erased = await getUserById(author.id);
      expect(erased?.deletedAt).not.toBeNull();
      expect(erased?.handle).toBeNull();
      expect(erased?.email).toBeNull();
      expect(erased?.name).toBeNull();
      expect(erased?.avatarUrl).toBeNull();
      expect(await getUserByHandle(handle)).toBeNull();

      // Published Comparisons stay; private work is erased.
      expect(await getComparisonRow(published.comparisonId)).not.toBeNull();
      expect(await getComparisonRow(unpublished.comparisonId)).toBeNull();

      const publishedView = await getComparisonForViewer(published.comparisonId, null);
      expect(publishedView?.author.handle).toBe(DELETED_AUTHOR_HANDLE);

      // Discussion keeps its shape: the comment is a tombstone, the reply lives.
      const comments = await getCommentViews(other.comparisonId, null);
      expect(comments).toHaveLength(1);
      expect(comments[0]?.id).toBe(authorComment.id);
      expect(comments[0]?.body).toBe('');
      expect(comments[0]?.deletedAt).not.toBeNull();
      expect(comments[0]?.replies).toHaveLength(1);
      expect(comments[0]?.replies[0]?.body).toBe('A reply that must survive.');
      expect(comments[0]?.replies[0]?.author.handle).toBe(reader.handle);

      const otherRow = await getComparisonRow(other.comparisonId);
      expect(otherRow?.commentCount).toBe(1);

      // The Annotation disappears from reader-facing views and the count.
      expect(await getAnnotationViews(other.comparisonId, null)).toHaveLength(0);
      expect(otherRow?.annotationCount).toBe(0);

      // Its opener is blanked; someone else's thread message survives.
      const messages = await db
        .select()
        .from(annotationMessages)
        .where(eq(annotationMessages.annotationId, annotation.id));
      expect(messages).toHaveLength(2);
      expect(messages.find((message) => message.authorId === author.id)?.body).toBe('');
      expect(
        messages.find((message) => message.authorId === reader.id)?.body,
      ).toBe('Thread reply that must survive.');

      // Votes the account cast, and votes on its content, are gone.
      const remainingVotes = await db
        .select()
        .from(votes)
        .where(eq(votes.targetId, authorComment.id));
      expect(remainingVotes).toHaveLength(0);
      expect(
        await db.select().from(votes).where(eq(votes.userId, author.id)),
      ).toHaveLength(0);

      // Sign-in rows, notifications and verification tokens are gone.
      expect(
        await db.select().from(authSessions).where(eq(authSessions.userId, author.id)),
      ).toHaveLength(0);
      expect(
        await db.select().from(authAccounts).where(eq(authAccounts.userId, author.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(authVerifications)
          .where(sql`${authVerifications.value}::jsonb->>'email' = ${email}`),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, author.id)),
      ).toHaveLength(0);

      // No ticker line still names the account or points at removed content.
      expect(
        await db
          .select()
          .from(activityEvents)
          .where(eq(activityEvents.actorId, author.id)),
      ).toHaveLength(0);
      const otherEvents = await db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.comparisonId, other.comparisonId));
      expect(
        otherEvents.some(
          (event) =>
            event.payload.commentId === authorComment.id ||
            event.payload.annotationId === annotation.id,
        ),
      ).toBe(false);

      // Open Boards are told the exact count deltas, so an already-hidden item
      // cannot subtract twice.
      const deletionEvent = otherEvents.find((event) => event.kind === 'account.deleted');
      expect(deletionEvent?.payload).toMatchObject({
        commentCount: 1,
        annotationCount: 1,
      });
      expect(deletionEvent?.payload.commentIds).toEqual([authorComment.id]);
    } finally {
      await author.cleanup();
      await published.cleanup();
      await unpublished.cleanup();
      await other.cleanup();
      await reader.cleanup();
    }
  });

  it('refuses an untyped confirmation and a second deletion', async () => {
    const author = await createUserFixture();

    try {
      expect(await errorCode(() => deleteAccount(author.id, 'yes'))).toBe(
        'confirmation_required',
      );
      expect((await getUserById(author.id))?.deletedAt).toBeNull();

      await deleteAccount(author.id, 'Delete ');
      expect(await errorCode(() => deleteAccount(author.id, 'delete'))).toBe(
        'account_deleted',
      );
    } finally {
      await author.cleanup();
    }
  });

  it('releases the handle and email so a new account can use them', async () => {
    const db = getDb();
    const email = `released-${uuidv7()}@example.test`;
    const author = await createUserFixture({ email });
    const handle = author.handle as string;
    const newcomer = await createUserFixture({ handle: null });

    try {
      await deleteAccount(author.id, 'delete');

      await setHandle(newcomer.id, handle);
      expect((await getUserById(newcomer.id))?.handle).toBe(handle);

      const [reborn] = await db
        .insert(users)
        .values({ id: uuidv7(), handle: null, email })
        .returning();
      expect(reborn?.email).toBe(email);
      if (reborn) await db.delete(users).where(eq(users.id, reborn.id));
    } finally {
      await author.cleanup();
      await newcomer.cleanup();
    }
  });

  it('does not subtract a reply that an Admin already removed from the comment count', async () => {
    const admin = await createUserFixture({ role: 'admin' });
    const author = await createUserFixture();
    const reader = await createUserFixture();
    const other = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });

    try {
      const root = await createComment({
        userId: reader.id,
        comparisonId: other.comparisonId,
        body: 'Thread root.',
      });
      const reply = await createComment({
        userId: author.id,
        comparisonId: other.comparisonId,
        parentId: root.id,
        body: 'Reply by the departing account.',
      });
      await createComment({
        userId: reader.id,
        comparisonId: other.comparisonId,
        body: 'Visible comment one.',
      });
      await createComment({
        userId: reader.id,
        comparisonId: other.comparisonId,
        body: 'Visible comment two.',
      });
      expect((await getComparisonRow(other.comparisonId))?.commentCount).toBe(4);
      expect(reply.id).toBeTruthy();

      const report = await createReport({
        reporterId: author.id,
        targetType: 'comment',
        targetId: root.id,
        reason: 'harassment',
      });
      await hideReportedContent(admin.id, report.id, 'Hiding the whole thread.');
      expect((await getComparisonRow(other.comparisonId))?.commentCount).toBe(2);

      await deleteAccount(author.id, 'delete');

      // The hidden reply was already excluded; tombstoning it must not subtract
      // it a second time.
      expect((await getComparisonRow(other.comparisonId))?.commentCount).toBe(2);
    } finally {
      await admin.cleanup();
      await author.cleanup();
      await reader.cleanup();
      await other.cleanup();
    }
  });
});

describe.skipIf(!available)('account export', () => {
  it('returns the signed-in account and its own content as machine-readable JSON', async () => {
    const db = getDb();
    const email = `exporter-${uuidv7()}@example.test`;
    const readerEmail = `reader-${uuidv7()}@example.test`;
    const author = await createUserFixture({ email });
    const reader = await createUserFixture({ email: readerEmail });
    const published = await createJobFixture({
      authorId: author.id,
      authorHandle: author.handle ?? undefined,
      comparisonStatus: 'published',
      runStatus: 'done',
    });
    const other = await createJobFixture({
      comparisonStatus: 'published',
      runStatus: 'done',
    });

    try {
      const authorComment = await createComment({
        userId: author.id,
        comparisonId: other.comparisonId,
        body: 'Exported comment body.',
      });
      const readerComment = await createComment({
        userId: reader.id,
        comparisonId: other.comparisonId,
        body: 'This is the reader\'s private wording.',
      });
      const annotation = await createAnnotation({
        userId: author.id,
        responseId: other.baseResponseId,
        kind: 'question',
        startOffset: 0,
        endOffset: 4,
        body: 'Exported thread opener.',
      });
      await addAnnotationMessage(annotation.id, reader.id, 'Reader thread reply.');
      await toggleVote(author.id, 'comment', readerComment.id);
      await createReport({
        reporterId: author.id,
        targetType: 'comment',
        targetId: readerComment.id,
        reason: 'spam',
        detail: 'Exported report detail.',
      });
      // The account's own reply in someone else's Annotation thread.
      const readerAnnotation = await createAnnotation({
        userId: reader.id,
        responseId: other.baseResponseId,
        kind: 'good',
        startOffset: 6,
        endOffset: 10,
        body: 'Reader-owned annotation.',
      });
      await addAnnotationMessage(
        readerAnnotation.id,
        author.id,
        'Exported reply on someone else thread.',
      );
      await db.insert(notifications).values({
        id: uuidv7(),
        userId: author.id,
        kind: 'job.ready',
        payload: { jobId: published.jobId, comparisonId: published.comparisonId },
      });

      const data = await exportAccountData(author.id);
      const serialised = JSON.stringify(data);

      expect(data.formatVersion).toBe(1);
      expect(data.exportedAt).toBeTruthy();
      expect(data.account).toMatchObject({
        id: author.id,
        handle: author.handle,
        email,
      });

      expect(data.comparisons.map((comparison) => comparison.id)).toEqual([
        published.comparisonId,
      ]);
      expect(data.comparisons[0]?.base?.contentMd).toContain('base answer');
      expect(data.comparisons[0]?.responses).toHaveLength(1);

      expect(data.comments.map((comment) => comment.id)).toEqual([authorComment.id]);
      expect(data.comments[0]?.body).toBe('Exported comment body.');

      expect(data.annotations.map((entry) => entry.id)).toEqual([annotation.id]);
      expect(data.annotations[0]?.messages.map((message) => message.body)).toEqual([
        'Exported thread opener.',
      ]);
      expect(data.annotationReplies).toEqual([
        expect.objectContaining({
          body: 'Exported reply on someone else thread.',
          annotationId: readerAnnotation.id,
          comparisonId: other.comparisonId,
          comparisonTitle: (await getComparisonRow(other.comparisonId))?.title,
        }),
      ]);

      expect(data.votes).toEqual([
        expect.objectContaining({ targetType: 'comment', targetId: readerComment.id }),
      ]);
      expect(data.notifications).toHaveLength(1);
      expect(data.notifications[0]?.kind).toBe('job.ready');
      expect(data.reports).toEqual([
        expect.objectContaining({
          targetType: 'comment',
          targetId: readerComment.id,
          reason: 'spam',
          detail: 'Exported report detail.',
        }),
      ]);

      // Someone else's email and words never enter the export.
      expect(serialised).not.toContain(readerEmail);
      expect(serialised).not.toContain("reader's private wording");
      expect(serialised).not.toContain('Reader thread reply.');
      expect(serialised).not.toContain('Reader-owned annotation.');
    } finally {
      await author.cleanup();
      await reader.cleanup();
      await published.cleanup();
      await other.cleanup();
    }
  });
});

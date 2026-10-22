import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  closeRedis,
  finalizeJob,
  getComparisonRow,
  getDb,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
  notifications,
  responses,
} from '../src/index';
import { createJobFixture, createUserFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; notification tests skipped');
}

async function notify(
  userId: string,
  payload: Record<string, unknown>,
  createdAt = new Date(),
) {
  const [row] = await getDb()
    .insert(notifications)
    .values({ userId, kind: 'job.ready', payload, createdAt })
    .returning();
  if (!row) throw new Error('notification fixture was not inserted');
  return row;
}

afterAll(async () => {
  await closeRedis();
  await closeDb();
});

describe.skipIf(!available)('notifications', () => {
  it('returns only notifications for the calling user, newest first, with their comparison', async () => {
    const fixture = await createJobFixture();
    const reader = await createUserFixture();

    try {
      const comparison = await getComparisonRow(fixture.comparisonId);
      const payload = { jobId: fixture.jobId, comparisonId: fixture.comparisonId };
      // job.ready is unique per Job, so the older row points at another Job.
      const older = await notify(
        fixture.userId,
        { ...payload, jobId: crypto.randomUUID() },
        new Date(Date.now() - 60_000),
      );
      const newer = await notify(fixture.userId, payload);

      // A second account must never see the first account's notifications.
      expect(await getNotifications(reader.id)).toHaveLength(0);

      const items = await getNotifications(fixture.userId);
      expect(items.map((item) => item.id)).toEqual([newer.id, older.id]);
      expect(items[0]?.payload).toMatchObject(payload);
      expect(items[0]?.comparison).toEqual({
        id: fixture.comparisonId,
        title: comparison?.title,
        status: 'generating',
      });
    } finally {
      await fixture.cleanup();
      await reader.cleanup();
    }
  });

  it('creates exactly one notification when completion is finalised concurrently', async () => {
    const fixture = await createJobFixture();

    try {
      await getDb()
        .update(responses)
        .set({ status: 'done', finishedAt: new Date() })
        .where(eq(responses.jobId, fixture.jobId));

      await Promise.all([finalizeJob(fixture.jobId), finalizeJob(fixture.jobId)]);

      const ready = (await getNotifications(fixture.userId)).filter(
        (notification) => notification.kind === 'job.ready',
      );
      expect(ready).toHaveLength(1);
      expect(ready[0]?.payload).toMatchObject({
        jobId: fixture.jobId,
        comparisonId: fixture.comparisonId,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('marks one notification read for its owner and leaves the rest unread', async () => {
    const fixture = await createJobFixture();

    try {
      const payload = { jobId: fixture.jobId, comparisonId: fixture.comparisonId };
      const first = await notify(
        fixture.userId,
        { ...payload, jobId: crypto.randomUUID() },
        new Date(Date.now() - 60_000),
      );
      const second = await notify(fixture.userId, payload);

      await markNotificationsRead(fixture.userId, { id: first.id });

      const items = await getNotifications(fixture.userId);
      expect(items.find((item) => item.id === first.id)?.readAt).toBeInstanceOf(Date);
      expect(items.find((item) => item.id === second.id)?.readAt).toBeNull();
      expect(await getUnreadNotificationCount(fixture.userId)).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('cannot touch another account notification, and mark-all is per reader', async () => {
    const fixture = await createJobFixture();
    const reader = await createUserFixture();

    try {
      const payload = { jobId: fixture.jobId, comparisonId: fixture.comparisonId };
      const authorNotification = await notify(fixture.userId, payload);
      const readerNotification = await notify(reader.id, payload);

      // The reader names the author's notification id; nothing may change.
      await markNotificationsRead(reader.id, { id: authorNotification.id });
      expect(await getUnreadNotificationCount(fixture.userId)).toBe(1);
      expect(await getUnreadNotificationCount(reader.id)).toBe(1);

      await markNotificationsRead(reader.id, { all: true });
      expect(await getUnreadNotificationCount(reader.id)).toBe(0);
      expect(await getUnreadNotificationCount(fixture.userId)).toBe(1);
      expect((await getNotifications(reader.id))[0]?.id).toBe(readerNotification.id);
    } finally {
      await fixture.cleanup();
      await reader.cleanup();
    }
  });
});

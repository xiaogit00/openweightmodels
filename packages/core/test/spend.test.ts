import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { responses } from '../src/db/schema';
import {
  assertWithinSpendCap,
  autoSkipJobId,
  closeDb,
  closeRedis,
  getJobForAuthor,
  getRunQueue,
  monthlySpendCapUsd,
  processRun,
  spendCapStatus,
  startOfNextUtcMonth,
  startOfUtcMonth,
} from '../src/index';
import { createJobFixture, servicesAvailable } from './index';

const available = await servicesAvailable();

afterAll(async () => {
  await closeRedis();
  await closeDb();
});

describe('spend cap configuration', () => {
  it('treats an unset, zero or invalid cap as disabled', () => {
    expect(monthlySpendCapUsd({} as NodeJS.ProcessEnv)).toBe(0);
    expect(monthlySpendCapUsd({ MONTHLY_SPEND_CAP_USD: '0' } as NodeJS.ProcessEnv)).toBe(0);
    expect(monthlySpendCapUsd({ MONTHLY_SPEND_CAP_USD: 'nope' } as NodeJS.ProcessEnv)).toBe(0);
    expect(monthlySpendCapUsd({ MONTHLY_SPEND_CAP_USD: '25.5' } as NodeJS.ProcessEnv)).toBe(25.5);
  });

  it('uses UTC calendar months', () => {
    const now = new Date('2026-10-29T23:59:00.000Z');
    expect(startOfUtcMonth(now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(startOfNextUtcMonth(now).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe.skipIf(!available)('monthly spend cap', () => {
  it('sums provider-reported cost and refuses a new generation once the cap is reached', async () => {
    const fixture = await createJobFixture();
    try {
      await getDb()
        .update(responses)
        .set({ costUsd: '1.500000', finishedAt: new Date() })
        .where(eq(responses.id, fixture.runIds[0]!));

      const status = await spendCapStatus({ env: { MONTHLY_SPEND_CAP_USD: '1' } as NodeJS.ProcessEnv });
      expect(status.enabled).toBe(true);
      expect(status.exceeded).toBe(true);
      expect(status.spentUsd).toBeGreaterThanOrEqual(1.5);
      expect(status.remainingUsd).toBe(0);
      expect(status.retryAfterSeconds).toBeGreaterThan(0);

      await expect(
        assertWithinSpendCap({ env: { MONTHLY_SPEND_CAP_USD: '1' } as NodeJS.ProcessEnv }),
      ).rejects.toMatchObject({
        code: 'spend_cap_reached',
        status: 429,
        retryAfterSeconds: expect.any(Number),
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('allows a generation while the cap is disabled', async () => {
    const status = await assertWithinSpendCap({ env: {} as NodeJS.ProcessEnv });
    expect(status.enabled).toBe(false);
    expect(status.exceeded).toBe(false);
  });

  it('stops a queued Run before the provider is called once the cap is reached', async () => {
    const fixture = await createJobFixture({ challengers: 2 });
    const original = process.env.MONTHLY_SPEND_CAP_USD;
    process.env.MONTHLY_SPEND_CAP_USD = '1';

    try {
      // A previously settled Run already used the whole cap.
      await getDb()
        .update(responses)
        .set({ costUsd: '1.250000', finishedAt: new Date() })
        .where(eq(responses.id, fixture.runIds[0]!));

      await processRun(fixture.runIds[1]!);

      const bundle = await getJobForAuthor(fixture.jobId, fixture.userId);
      const target = bundle?.runs.find((run) => run.id === fixture.runIds[1]);
      expect(target?.status).toBe('failed');
      expect(target?.error).toContain('monthly provider spend cap');
    } finally {
      await getRunQueue()
        .getJob(autoSkipJobId(fixture.runIds[1]!, 0))
        .then((job) => job?.remove())
        .catch(() => undefined);
      await fixture.cleanup();
      if (original === undefined) delete process.env.MONTHLY_SPEND_CAP_USD;
      else process.env.MONTHLY_SPEND_CAP_USD = original;
    }
  });
});

import { gte, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { responses } from './db/schema';
import { DomainError } from './services/errors';

/**
 * The absolute provider-spend ceiling. It is a monthly UTC budget over
 * provider-reported `responses.cost_usd`, not an AWS budget: OpenRouter spend
 * never appears on the AWS bill. `0` (the local default) disables the cap;
 * staging always sets a positive value.
 */
export type SpendCapStatus = {
  enabled: boolean;
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
  exceeded: boolean;
  /** Epoch milliseconds when the monthly window rolls over. */
  resetsAt: number;
  retryAfterSeconds: number;
};

export function monthlySpendCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.MONTHLY_SPEND_CAP_USD);
  return Number.isFinite(configured) && configured > 0 ? configured : 0;
}

export function startOfUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function startOfNextUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export async function currentMonthSpendUsd(now: Date = new Date()): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${responses.costUsd}), 0)` })
    .from(responses)
    .where(gte(responses.finishedAt, startOfUtcMonth(now)));

  const spent = Number(row?.total ?? 0);
  return Number.isFinite(spent) ? spent : 0;
}

export async function spendCapStatus(
  options: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<SpendCapStatus> {
  const now = options.now ?? new Date();
  const capUsd = monthlySpendCapUsd(options.env);
  const spentUsd = capUsd > 0 ? await currentMonthSpendUsd(now) : 0;
  const resetsAt = startOfNextUtcMonth(now).getTime();
  const retryAfterSeconds = Math.max(1, Math.ceil((resetsAt - now.getTime()) / 1000));

  return {
    enabled: capUsd > 0,
    capUsd,
    spentUsd,
    remainingUsd: capUsd > 0 ? Math.max(0, capUsd - spentUsd) : Number.POSITIVE_INFINITY,
    exceeded: capUsd > 0 && spentUsd >= capUsd,
    resetsAt,
    retryAfterSeconds,
  };
}

/**
 * Call before scheduling or calling a provider. The worker checks again as a
 * defence in depth: a queued Run may have been created before the cap was hit.
 */
export async function assertWithinSpendCap(
  options: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<SpendCapStatus> {
  const status = await spendCapStatus(options);
  if (!status.exceeded) return status;

  throw new DomainError(
    'spend_cap_reached',
    `The monthly provider spend cap of $${status.capUsd.toFixed(2)} has been reached. New Runs resume on ${new Date(status.resetsAt).toISOString().slice(0, 10)}.`,
    429,
    { retryAfterSeconds: status.retryAfterSeconds },
  );
}

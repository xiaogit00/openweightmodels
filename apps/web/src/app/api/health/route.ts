import { getRedis, getSql } from '@owm/core';
import { evaluateHealth, healthHttpStatus } from '@/lib/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ALB/Target Group health check. Public and dependency-aware: 503 only when
 * Postgres is unreachable, because the app can still serve reads without Redis.
 */
export async function GET() {
  const report = await evaluateHealth({
    database: async () => {
      await getSql()`select 1`;
    },
    redis: async () => {
      await getRedis().ping();
    },
  });

  return Response.json(report, {
    status: healthHttpStatus(report),
    headers: { 'cache-control': 'no-store' },
  });
}

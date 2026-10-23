export type ProbeState = 'ok' | 'error';

export type HealthReport = {
  status: 'ok' | 'degraded' | 'unhealthy';
  checks: {
    database: ProbeState;
    redis: ProbeState;
  };
};

export type HealthProbes = {
  database: () => Promise<unknown>;
  redis: () => Promise<unknown>;
  timeoutMs?: number;
};

async function runProbe(probe: () => Promise<unknown>, timeoutMs: number): Promise<ProbeState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('probe timed out')), timeoutMs);
      }),
    ]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The ALB health check must keep serving reads when Redis is down: Postgres is
 * canonical and SSE falls back to polling. A failed database is fatal, because
 * every screen and the job pipeline depend on it.
 */
export async function evaluateHealth(probes: HealthProbes): Promise<HealthReport> {
  const timeoutMs = probes.timeoutMs ?? 2_000;
  const [database, redis] = await Promise.all([
    runProbe(probes.database, timeoutMs),
    runProbe(probes.redis, timeoutMs),
  ]);

  return {
    status: database === 'error' ? 'unhealthy' : redis === 'error' ? 'degraded' : 'ok',
    checks: { database, redis },
  };
}

export function healthHttpStatus(report: HealthReport): 200 | 503 {
  return report.status === 'unhealthy' ? 503 : 200;
}

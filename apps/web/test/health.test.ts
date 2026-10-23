import { describe, expect, it } from 'vitest';
import { evaluateHealth, healthHttpStatus } from '../src/lib/health';

describe('health report', () => {
  it('is ok only when both probes answer', async () => {
    const report = await evaluateHealth({
      database: async () => true,
      redis: async () => true,
    });
    expect(report).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok' },
    });
    expect(healthHttpStatus(report)).toBe(200);
  });

  it('stays healthy when Redis is down because reads keep working', async () => {
    const report = await evaluateHealth({
      database: async () => true,
      redis: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual({ database: 'ok', redis: 'error' });
    expect(healthHttpStatus(report)).toBe(200);
  });

  it('fails the ALB check when Postgres is unreachable', async () => {
    const report = await evaluateHealth({
      database: async () => {
        throw new Error('no database');
      },
      redis: async () => true,
    });
    expect(report.status).toBe('unhealthy');
    expect(healthHttpStatus(report)).toBe(503);
  });

  it('times out a hanging probe instead of holding the health check open', async () => {
    const report = await evaluateHealth({
      database: async () => new Promise(() => {}),
      redis: async () => true,
      timeoutMs: 20,
    });
    expect(report.status).toBe('unhealthy');
  });
});

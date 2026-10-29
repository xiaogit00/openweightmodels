import { describe, expect, it, vi } from 'vitest';
import { queueMetricsLine, readQueueCounts, startQueueMetrics } from '../src/metrics';

const queue = {
  async getJobCounts() {
    return { waiting: 3, active: 1, delayed: 2, failed: 4 };
  },
};

describe('queue metrics', () => {
  it('emits one JSON line with the depth the alarm watches', async () => {
    const counts = await readQueueCounts(queue);
    expect(counts).toEqual({ waiting: 3, active: 1, delayed: 2, failed: 4 });

    const line = JSON.parse(queueMetricsLine(counts));
    expect(line).toMatchObject({
      metric: 'queue',
      queue: 'owm-runs',
      waiting: 3,
      active: 1,
      delayed: 2,
      failed: 4,
      depth: 5,
    });
  });

  it('is off unless enabled', () => {
    expect(startQueueMetrics({ enabled: false })).toBeNull();
  });

  it('emits immediately and stops cleanly', async () => {
    const log = vi.fn();
    const metrics = startQueueMetrics({ enabled: true, queue, log, intervalMs: 10_000 });
    expect(metrics).not.toBeNull();

    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ metric: 'queue', depth: 5 });

    metrics!.stop();
  });

  it('does not crash the worker when the queue cannot be read', async () => {
    const log = vi.fn();
    const broken = { async getJobCounts() { throw new Error('redis down'); } };
    const metrics = startQueueMetrics({ enabled: true, queue: broken, log, intervalMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(log).not.toHaveBeenCalled();
    metrics!.stop();
  });
});

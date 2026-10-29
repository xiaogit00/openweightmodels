import { RUN_QUEUE, getRunQueue } from '@owm/core';

export type QueueCounts = {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
};

export type QueueReader = {
  getJobCounts: (
    ...types: Array<'waiting' | 'active' | 'delayed' | 'failed'>
  ) => Promise<Record<string, number>>;
};

/**
 * Emit queue depth as one JSON log line. A CloudWatch Logs metric filter in the
 * ops stack turns it into the `OWM/Queue Depth` metric and its alarm, so the
 * worker needs no CloudWatch SDK or `cloudwatch:PutMetricData` permission.
 */
export function queueMetricsLine(counts: QueueCounts) {
  return JSON.stringify({
    metric: 'queue',
    queue: RUN_QUEUE,
    at: new Date().toISOString(),
    waiting: counts.waiting,
    active: counts.active,
    delayed: counts.delayed,
    failed: counts.failed,
    // The alarm watches this value: queued but not yet running work.
    depth: counts.waiting + counts.delayed,
  });
}

export async function readQueueCounts(queue: QueueReader = getRunQueue()): Promise<QueueCounts> {
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
  return {
    waiting: Number(counts.waiting ?? 0),
    active: Number(counts.active ?? 0),
    delayed: Number(counts.delayed ?? 0),
    failed: Number(counts.failed ?? 0),
  };
}

export async function logQueueMetrics(queue: QueueReader = getRunQueue()) {
  const line = queueMetricsLine(await readQueueCounts(queue));
  console.log(line);
  return line;
}

/**
 * Off by default locally so `pnpm dev:worker` stays quiet; the ECS worker task
 * sets `QUEUE_METRICS=true`.
 */
export function startQueueMetrics(options: {
  intervalMs?: number;
  queue?: QueueReader;
  enabled?: boolean;
  log?: (line: string) => void;
} = {}) {
  const enabled = options.enabled ?? process.env.QUEUE_METRICS === 'true';
  if (!enabled) return null;

  const intervalMs = Math.max(10_000, options.intervalMs ?? 60_000);
  const emit = async () => {
    try {
      if (options.log) {
        options.log(queueMetricsLine(await readQueueCounts(options.queue)));
      } else {
        await logQueueMetrics(options.queue);
      }
    } catch (error) {
      console.error('[worker] queue metrics failed', error);
    }
  };

  void emit();
  const timer = setInterval(() => void emit(), intervalMs);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}

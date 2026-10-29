import type { JobRunState, ResponseStatus } from '@owm/core/client';

export type ReplayState = {
  key: string;
  modelName: string;
  monogram: string;
  runs: JobRunState[];
  turnNumber: number;
  turnCount: number;
  status: ResponseStatus | 'stopped';
  failedRun: JobRunState | null;
  progress: number;
  tokens: number;
  latencyMs: number | null;
};

/**
 * The Job page shows one row per Challenger, not one per Turn. A Replay is the
 * Challenger's Responses in Turn order, so its row reports how far it has got
 * and surfaces the one Turn that needs Retry or Skip.
 */
export function groupReplays(runs: JobRunState[]): ReplayState[] {
  const groups = new Map<string, JobRunState[]>();
  for (const run of runs) {
    const list = groups.get(run.modelId) ?? [];
    list.push(run);
    groups.set(run.modelId, list);
  }

  return [...groups.entries()].map(([modelId, group]) => {
    const ordered = [...group].sort((left, right) => left.turnNumber - right.turnNumber);
    const first = ordered[0]!;
    const failedRun = ordered.find((run) => run.status === 'failed') ?? null;
    const pendingRun =
      ordered.find((run) => ['calling', 'streaming', 'queued'].includes(run.status)) ?? null;
    const allDone = ordered.every((run) => run.status === 'done');
    const firstSkipped = ordered.find((run) => run.status === 'skipped') ?? null;
    const status: ReplayState['status'] = failedRun
      ? 'failed'
      : allDone
        ? 'done'
        : firstSkipped && !pendingRun
          ? 'stopped'
          : (pendingRun?.status ?? 'queued');
    const current =
      failedRun ??
      pendingRun ??
      (status === 'stopped' ? firstSkipped : ordered[ordered.length - 1])!;
    const tokens = ordered.reduce((total, run) => total + run.tokens, 0);
    const latencyMs = ordered.reduce<number | null>((total, run) => {
      if (run.latencyMs === null) return total;
      return (total ?? 0) + run.latencyMs;
    }, null);

    return {
      key: modelId,
      modelName: first.modelName,
      monogram: first.monogram,
      runs: ordered,
      turnNumber: current.turnNumber,
      turnCount: first.turnCount,
      status,
      failedRun,
      progress: Math.round(
        ordered.reduce((total, run) => total + run.progress, 0) / ordered.length,
      ),
      tokens,
      latencyMs,
    };
  });
}

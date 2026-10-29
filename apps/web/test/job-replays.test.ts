import { describe, expect, it } from 'vitest';
import type { JobRunState, ResponseStatus } from '@owm/core/client';
import { groupReplays } from '../src/lib/job-replays';

function run(
  modelId: string,
  turnNumber: number,
  status: ResponseStatus,
  overrides: Partial<JobRunState> = {},
): JobRunState {
  return {
    id: `${modelId}-${turnNumber}`,
    modelId,
    modelName: `Model ${modelId}`,
    monogram: 'MM',
    status,
    tokens: 10 * turnNumber,
    latencyMs: status === 'done' ? 1000 : null,
    error: status === 'failed' ? 'API timeout' : null,
    attempt: 0,
    progress: status === 'done' || status === 'skipped' ? 100 : status === 'failed' ? 45 : 0,
    turnId: `turn-${turnNumber}`,
    turnNumber,
    turnCount: 3,
    ...overrides,
  };
}

describe('groupReplays', () => {
  it('reports one row per Challenger with its current Turn', () => {
    const replays = groupReplays([
      run('a', 1, 'done'),
      run('b', 1, 'streaming', { tokens: 5, progress: 40 }),
      run('a', 2, 'queued'),
      run('b', 2, 'queued'),
    ]);

    expect(replays).toHaveLength(2);
    expect(replays.find((replay) => replay.key === 'a')).toMatchObject({
      status: 'queued',
      turnNumber: 2,
      turnCount: 3,
    });
    expect(replays.find((replay) => replay.key === 'b')).toMatchObject({
      status: 'streaming',
      turnNumber: 1,
    });
  });

  it('surfaces the failed Turn as the row action target', () => {
    const failed = run('a', 2, 'failed');
    const [replay] = groupReplays([
      run('a', 1, 'done'),
      failed,
      run('a', 3, 'queued'),
    ]);

    expect(replay).toMatchObject({
      status: 'failed',
      turnNumber: 2,
      failedRun: { id: failed.id },
    });
  });

  it('labels a stopped Replay at the first skipped Turn, not the last one', () => {
    const [replay] = groupReplays([
      run('a', 1, 'done'),
      run('a', 2, 'skipped'),
      run('a', 3, 'skipped'),
    ]);

    expect(replay).toMatchObject({
      status: 'stopped',
      turnNumber: 2,
      turnCount: 3,
      failedRun: null,
    });
    expect(replay?.runs.some((item) => item.status === 'done')).toBe(true);
  });

  it('marks a fully answered Replay done at its final Turn', () => {
    const [replay] = groupReplays([
      run('a', 1, 'done'),
      run('a', 2, 'done'),
      run('a', 3, 'done'),
    ]);

    expect(replay).toMatchObject({ status: 'done', turnNumber: 3, progress: 100 });
  });
});

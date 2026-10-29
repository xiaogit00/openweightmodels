import { describe, expect, it } from 'vitest';
import type { ResponseStatus } from '@owm/core/client';
import {
  modelsWithReplayInProgress,
  type ComparisonResponseView,
} from '../src/lib/comparison-responses';

function response(
  slug: string,
  status: ResponseStatus,
  isBase = false,
): Pick<ComparisonResponseView, 'isBase' | 'status' | 'model'> {
  return { isBase, status, model: { slug, name: slug, monogram: 'MM' } };
}

describe('modelsWithReplayInProgress', () => {
  it('marks a reader-visible Challenger while its later Turns are pending', () => {
    const marked = modelsWithReplayInProgress([
      response('base', 'done', true),
      response('alpha', 'done'),
      response('alpha', 'queued'),
      response('beta', 'done'),
    ]);

    expect([...marked]).toEqual(['alpha']);
  });

  it('does not mark a Challenger with no finished Turn for a reader', () => {
    expect(
      modelsWithReplayInProgress([
        response('alpha', 'queued'),
        response('alpha', 'queued'),
      ]),
    ).toEqual(new Set());
  });

  it('marks the Author-visible Replay from its first queued Turn', () => {
    expect(
      [
        ...modelsWithReplayInProgress(
          [response('alpha', 'queued'), response('alpha', 'queued')],
          { includeModelsWithoutDoneTurn: true },
        ),
      ],
    ).toEqual(['alpha']);
  });

  it('stops marking once every Turn has settled', () => {
    expect(
      modelsWithReplayInProgress([
        response('alpha', 'done'),
        response('alpha', 'done'),
      ]),
    ).toEqual(new Set());
  });

  it('does not mark a Replay that is paused on a failed Turn', () => {
    expect(
      modelsWithReplayInProgress([
        response('alpha', 'done'),
        response('alpha', 'failed'),
        response('alpha', 'queued'),
      ]),
    ).toEqual(new Set());
  });
});

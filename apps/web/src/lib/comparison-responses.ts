import { buildBlocks, type ComparisonBundle } from '@owm/core';
import type { Block, ResponseStatus } from '@owm/core/client';

/**
 * Browser projection of one Comparison response. Defined here so the page
 * render and the author-only resync share a shape without the server importing
 * a client component for a type.
 */
export type ComparisonResponseView = {
  id: string;
  jobId: string | null;
  isBase: boolean;
  contentMd: string;
  tokens: number;
  latencyMs: number | null;
  status: ResponseStatus;
  error: string | null;
  model: { slug: string; name: string; monogram: string };
  turn: { id: string; position: number; prompt: string };
  blocks: Block[];
};

/**
 * Server-side projection of a Comparison response for the browser view. Used by
 * both the page render and the author-only resync after a Run settles, so a tab
 * never has to trust partial SSE payloads for its body.
 */
export function toComparisonResponseViews(
  bundle: ComparisonBundle,
): ComparisonResponseView[] {
  const turnMap = new Map(bundle.turns.map((turn) => [turn.id, turn]));
  return bundle.responses.map(({ response, model }) => {
    const turn = turnMap.get(response.turnId);
    return {
      id: response.id,
      jobId: response.jobId,
      isBase: response.isBase,
      contentMd: response.contentMd,
      tokens: response.tokens,
      latencyMs: response.latencyMs,
      status: response.status,
      error: response.error,
      model: {
        slug: model.slug,
        name: model.displayName,
        monogram: model.monogram,
      },
      turn: {
        id: response.turnId,
        position: turn?.position ?? 0,
        prompt: turn?.prompt ?? '',
      },
      blocks: response.status === 'done' ? buildBlocks(response.contentMd) : [],
    };
  });
}

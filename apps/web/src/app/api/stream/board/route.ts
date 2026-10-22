import { BOARD_CHANNEL, activityAfter } from '@owm/core';
import { sseResponse, type SseEvent } from '@/lib/sse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return sseResponse({
    request,
    channel: BOARD_CHANNEL,
    replay: async (afterId): Promise<SseEvent[]> => {
      const rows = await activityAfter(afterId, 300);
      return rows.map((row) => ({
        id: row.id,
        type: row.kind,
        data: row,
      }));
    },
  });
}

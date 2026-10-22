import { getJobForAuthor, jobChannel, jobEventsAfter } from '@owm/core';
import { getViewerId } from '@/lib/auth';
import { sseResponse, type SseEvent } from '@/lib/sse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewerId = await getViewerId();
  const job = await getJobForAuthor(id, viewerId);
  if (!job) {
    return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Job not found.' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return sseResponse({
    request,
    channel: jobChannel(id),
    replay: async (afterId): Promise<SseEvent[]> => {
      const rows = await jobEventsAfter(id, afterId, 1000);
      return rows.map((row) => ({
        id: row.id,
        type: row.kind,
        data: row,
      }));
    },
  });
}

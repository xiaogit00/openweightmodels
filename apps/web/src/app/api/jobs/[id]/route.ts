import { getJobForAuthor } from '@owm/core';
import { apiError, json } from '@/lib/api';
import { getViewerId } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const viewerId = await getViewerId();
    const job = await getJobForAuthor(id, viewerId);
    if (!job) {
      return json({ error: { code: 'not_found', message: 'Job not found.' } }, { status: 404 });
    }
    return json(job);
  } catch (error) {
    return apiError(error);
  }
}

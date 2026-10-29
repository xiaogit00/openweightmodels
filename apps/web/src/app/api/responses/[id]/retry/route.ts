import { retryRun } from '@owm/core';
import { apiError, json } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { enforceRunLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    await enforceRunLimit(user.id);
    const { id } = await params;
    await retryRun(id, user.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

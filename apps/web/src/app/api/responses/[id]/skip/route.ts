import { skipRun } from '@owm/core';
import { apiError, json } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await skipRun(id, user.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

import { restoreComparison } from '@owm/core';
import { apiError, json } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    await restoreComparison(admin.id, id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

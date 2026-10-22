import { takeDownComparison } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { adminTakedownSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const { reason } = adminTakedownSchema.parse(await readJson(request));
    await takeDownComparison(admin.id, id, reason);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

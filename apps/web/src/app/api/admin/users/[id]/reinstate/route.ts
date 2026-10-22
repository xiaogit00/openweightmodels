import { reinstateUser } from '@owm/core';
import { apiError, json, readOptionalJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { adminOptionalReasonSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const { reason } = adminOptionalReasonSchema.parse(await readOptionalJson(request));
    await reinstateUser(admin.id, id, reason);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

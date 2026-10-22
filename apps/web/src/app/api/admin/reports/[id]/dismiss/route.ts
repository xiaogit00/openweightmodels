import { dismissReport } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { adminDismissSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const { note } = adminDismissSchema.parse(await readJson(request));
    await dismissReport(admin.id, id, note);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

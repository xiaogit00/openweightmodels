import { setModelEnabled } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { adminModelPatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const patch = adminModelPatchSchema.parse(await readJson(request));
    return json({ model: await setModelEnabled(admin.id, id, patch.enabled) });
  } catch (error) {
    return apiError(error);
  }
}

import { deleteCategory, renameCategory } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { adminCategoryPatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const patch = adminCategoryPatchSchema.parse(await readJson(request));
    return json({ category: await renameCategory(admin.id, id, patch.displayName) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    await deleteCategory(admin.id, id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

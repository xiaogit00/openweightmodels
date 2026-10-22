import { deleteAnnotation, updateAnnotation } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { annotationPatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = annotationPatchSchema.parse(await readJson(request));
    await updateAnnotation(id, user.id, body.kind);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await deleteAnnotation(id, user.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

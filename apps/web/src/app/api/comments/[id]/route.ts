import { deleteComment, updateComment } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { commentPatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = commentPatchSchema.parse(await readJson(request));
    await updateComment(id, user.id, body.body);
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
    await deleteComment(id, user.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

import { deleteAnnotationMessage, updateAnnotationMessage } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { messageCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const user = await requireUser();
    const { id, messageId } = await params;
    const body = messageCreateSchema.parse(await readJson(request));
    await updateAnnotationMessage(id, messageId, user.id, body.body);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const user = await requireUser();
    const { id, messageId } = await params;
    await deleteAnnotationMessage(id, messageId, user.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

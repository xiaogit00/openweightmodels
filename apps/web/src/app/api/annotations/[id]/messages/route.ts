import { addAnnotationMessage } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { messageCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = messageCreateSchema.parse(await readJson(request));
    const message = await addAnnotationMessage(id, user.id, body.body);
    return json({ message }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

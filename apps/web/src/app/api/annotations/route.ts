import { createAnnotation } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { annotationCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = annotationCreateSchema.parse(await readJson(request));
    const annotation = await createAnnotation({ ...body, userId: user.id });
    return json({ annotation }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

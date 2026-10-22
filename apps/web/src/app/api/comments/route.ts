import { createComment } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { commentCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = commentCreateSchema.parse(await readJson(request));
    const comment = await createComment({ ...body, userId: user.id });
    return json({ comment }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

import { addModelToComparison } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { responseCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = responseCreateSchema.parse(await readJson(request));
    const result = await addModelToComparison(id, body.modelId, user.id);
    return json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

import { toggleVote } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { voteSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = voteSchema.parse(await readJson(request));
    const result = await toggleVote(user.id, body.targetType, body.targetId);
    return json(result);
  } catch (error) {
    return apiError(error);
  }
}

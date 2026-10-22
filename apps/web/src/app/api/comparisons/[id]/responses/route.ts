import {
  addModelToComparison,
  getComparisonForViewer,
  requireOwnedComparison,
} from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireSession, requireUser } from '@/lib/auth';
import { toComparisonResponseViews } from '@/lib/comparison-responses';
import { responseCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // A suspended Author keeps read access to their own Comparison, so this
    // endpoint asks for a session rather than a writable account.
    const user = await requireSession();
    const { id } = await params;
    await requireOwnedComparison(id, user.id);
    const bundle = await getComparisonForViewer(id, user.id);
    if (!bundle) {
      return json({ error: { code: 'not_found', message: 'Comparison not found.' } }, { status: 404 });
    }
    return json({ responses: toComparisonResponseViews(bundle) });
  } catch (error) {
    return apiError(error);
  }
}

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

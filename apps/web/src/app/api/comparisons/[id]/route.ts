import {
  getAnnotationViews,
  getCommentViews,
  getComparisonForViewer,
  softDeleteComparison,
  updateComparison,
} from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { getViewerId, requireUser } from '@/lib/auth';
import { comparisonPatchSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const viewerId = await getViewerId();
    const bundle = await getComparisonForViewer(id, viewerId);
    if (!bundle) {
      return json({ error: { code: 'not_found', message: 'Comparison not found.' } }, { status: 404 });
    }
    const [annotations, comments] = await Promise.all([
      getAnnotationViews(id, viewerId),
      getCommentViews(id, viewerId),
    ]);
    return json({ ...bundle, annotations, comments });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const patch = comparisonPatchSchema.parse(await readJson(request));
    await updateComparison(id, user.id, patch);
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
    await softDeleteComparison(id, user.id);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

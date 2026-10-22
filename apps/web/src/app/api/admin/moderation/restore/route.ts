import { restoreModeratedContent } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { adminRestoreSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Restores Comments and Annotations an Admin hid; Comparisons have their own route. */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const { targetType, targetId, reason } = adminRestoreSchema.parse(
      await readJson(request),
    );
    await restoreModeratedContent(admin.id, targetType, targetId, reason);
    return json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

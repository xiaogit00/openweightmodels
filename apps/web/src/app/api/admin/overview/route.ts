import { getAdminOverview } from '@owm/core';
import { apiError, json } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The Admin page re-reads this after every mutation. */
export async function GET() {
  try {
    const admin = await requireAdmin();
    return json({ overview: await getAdminOverview(admin.id) });
  } catch (error) {
    return apiError(error);
  }
}

import { exportAccountData } from '@owm/core';
import { apiError, json } from '@/lib/api';
import { requireSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A point-in-time copy of the signed-in account's own data. It is a download,
 * not a page: the browser saves a JSON file so the member can keep or move it.
 */
export async function GET() {
  try {
    const user = await requireSession();
    const data = await exportAccountData(user.id);
    const stamp = new Date().toISOString().slice(0, 10);
    const label = data.account.handle ?? 'account';

    return json(data, {
      headers: {
        'Content-Disposition': `attachment; filename="openweightmodels-${label}-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

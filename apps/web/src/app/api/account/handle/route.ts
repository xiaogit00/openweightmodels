import { forbidden, setHandle, unauthorized } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { handleSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * First-sign-in onboarding. Any signed-in account may set its handle once;
 * changing it later is not designed yet (DECISIONS.md open question 4).
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw unauthorized();
    if (user.handle) {
      throw forbidden('Your handle is already set.');
    }

    const body = handleSchema.parse(await readJson(request));
    const updated = await setHandle(user.id, body.handle);
    return json({ user: { id: updated.id, handle: updated.handle } });
  } catch (error) {
    return apiError(error);
  }
}

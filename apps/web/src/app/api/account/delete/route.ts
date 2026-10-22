import { cookies } from 'next/headers';
import { deleteAccount } from '@owm/core';
import { apiError, json, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { deleteAccountSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Erases the signed-in account. The member must type DELETE, and the service
 * keeps published work under an anonymous attribution while removing private
 * drafts, personal fields and every session.
 */
export async function POST(request: Request) {
  try {
    const user = await requireSession();
    const body = deleteAccountSchema.parse(await readJson(request));
    await deleteAccount(user.id, body.confirmation);

    // The account's sessions are gone in the database; expire the browser's
    // copies too so the next request is unambiguously anonymous.
    const store = await cookies();
    for (const cookie of store.getAll()) {
      if (cookie.name.includes('better-auth') || cookie.name === 'owm_user') {
        store.delete(cookie.name);
      }
    }

    return json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}

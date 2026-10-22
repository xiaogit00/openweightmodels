import { cookies } from 'next/headers';
import { getUserByHandle, unauthorized, type UserRow } from '@owm/core';

const isProduction = process.env.NODE_ENV === 'production';

export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const handle = store.get('owm_user')?.value;
  if (handle) return getUserByHandle(handle);

  if (!isProduction) {
    return getUserByHandle(process.env.DEV_DEFAULT_USER ?? 'mira');
  }
  return null;
}

export async function getViewerId() {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

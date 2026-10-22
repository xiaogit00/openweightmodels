import { NextResponse } from 'next/server';
import { getUserByHandle } from '@owm/core';
import { auth } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { isDevelopmentIdentityAllowed } from '@/lib/identity-policy';

export const dynamic = 'force-dynamic';

/**
 * Development-only identity switcher. It is impossible to use when
 * NODE_ENV=production, even if ALLOW_DEV_USER_SWITCH is left at "true".
 */
export async function POST(request: Request) {
  try {
    if (!isDevelopmentIdentityAllowed()) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Not found.' } },
        { status: 404 },
      );
    }
    const body = (await request.json()) as { handle?: string };
    const handle = body.handle?.trim().toLowerCase();
    if (!handle) {
      return NextResponse.json(
        { error: { code: 'handle_required', message: 'A handle is required.' } },
        { status: 400 },
      );
    }
    const user = await getUserByHandle(handle);
    if (!user) {
      return NextResponse.json(
        { error: { code: 'user_not_found', message: 'No seeded user with that handle.' } },
        { status: 404 },
      );
    }
    const response = NextResponse.json({ user: { id: user.id, handle: user.handle } });
    // Switching identities must not leave a real session in place, or
    // session-first lookup would keep returning the previous account.
    try {
      const signedOut = await auth.api.signOut({
        headers: request.headers,
        asResponse: true,
      });
      for (const cookie of signedOut.headers.getSetCookie()) {
        response.headers.append('set-cookie', cookie);
      }
    } catch {
      // No live session; nothing to clear.
    }
    response.cookies.set('owm_user', user.handle!, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}

/** Clears the development identity cookie. */
export async function DELETE() {
  if (!isDevelopmentIdentityAllowed()) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete('owm_user');
  return response;
}

import { NextResponse } from 'next/server';
import { getUserByHandle } from '@owm/core';
import { apiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.ALLOW_DEV_USER_SWITCH === 'false'
    ) {
      return NextResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
    }
    const body = (await request.json()) as { handle?: string };
    const handle = body.handle?.trim();
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
    response.cookies.set('owm_user', user.handle, {
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

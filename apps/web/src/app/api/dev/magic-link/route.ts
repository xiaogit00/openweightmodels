import { NextResponse } from 'next/server';
import { isDevelopmentIdentityAllowed } from '@/lib/identity-policy';
import { latestDevMagicLink } from '@/lib/mail';

export const dynamic = 'force-dynamic';

/**
 * Development-only access to the most recent magic link, so the flow can be
 * exercised without Mailpit. Never available in production.
 */
export async function GET(request: Request) {
  if (!isDevelopmentIdentityAllowed()) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not found.' } },
      { status: 404 },
    );
  }

  const email = new URL(request.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: { code: 'email_required', message: 'An email is required.' } },
      { status: 400 },
    );
  }

  const url = latestDevMagicLink(email);
  if (!url) {
    return NextResponse.json(
      { error: { code: 'no_link', message: 'No magic link has been requested for that email.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ url });
}

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { safeNextPath, signInPath } from '@/lib/next-path';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Signing in — OpenWeightModels',
  robots: { index: false, follow: false },
};

/**
 * Redirect target after Better Auth verifies a magic link. It routes a new
 * account to handle onboarding and everyone else to where they were going.
 */
export default async function AuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeNextPath(Array.isArray(query.next) ? query.next[0] : query.next);
  const error = Array.isArray(query.error) ? query.error[0] : query.error;

  if (error) {
    redirect(
      `${signInPath(next)}${next === '/' ? '?' : '&'}error=${encodeURIComponent(error)}`,
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect(signInPath(next));
  if (!user.handle) redirect(`/onboarding?next=${encodeURIComponent(next)}`);
  redirect(next);
}

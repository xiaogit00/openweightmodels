import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SignInForm } from '@/components/sign-in-form';
import { getCurrentUser } from '@/lib/auth';
import { MAGIC_LINK_TTL_MINUTES } from '@/lib/auth-constants';
import { safeNextPath, signInPath } from '@/lib/next-path';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign in — OpenWeightModels',
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN: 'That sign-in link is invalid, expired or already used. Request a new one.',
  expired: 'That sign-in link has expired. Request a new one.',
  EMAIL_NOT_VERIFIED: 'That email could not be verified. Request a new link.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeNextPath(Array.isArray(query.next) ? query.next[0] : query.next);
  const errorParam = Array.isArray(query.error) ? query.error[0] : query.error;

  const user = await getCurrentUser();
  if (user) redirect(user.handle ? next : `/onboarding?next=${encodeURIComponent(next)}`);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader handle={null} variant="page" showNew={false} signInHref={signInPath(next)} />
      <main className="mx-auto flex w-full max-w-[420px] flex-col gap-5 px-5 py-12">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-heading text-[20px] font-medium leading-[1.2]">
            Sign in
          </h1>
          <p className="m-0 text-[12px] leading-[1.55] text-neutral-400">
            Enter your email and we will send you a link. It signs you in once and expires
            after {MAGIC_LINK_TTL_MINUTES} minutes.
          </p>
        </div>
        <div className="rounded-[2px] border border-neutral-800 bg-surface p-4">
          <SignInForm
            next={next}
            initialError={errorParam ? (ERROR_MESSAGES[errorParam] ?? 'The sign-in link could not be used. Request a new one.') : null}
          />
        </div>
      </main>
    </div>
  );
}

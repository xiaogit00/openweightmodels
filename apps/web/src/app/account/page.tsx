import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountSettings } from '@/components/account-settings';
import { SiteHeader } from '@/components/site-header';
import { getCurrentUser } from '@/lib/auth';
import { signInPath } from '@/lib/next-path';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Account — OpenWeightModels',
  robots: { index: false, follow: false },
};

function joined(value: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(value);
}

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect(signInPath('/account'));

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader handle={user.handle} signedIn variant="page" showNew={false} />
      <main className="mx-auto flex w-full max-w-[560px] flex-col gap-5 px-5 py-12">
        <div className="flex flex-col gap-1.5">
          <span className="micro-label uppercase">Account</span>
          <h1 className="m-0 font-heading text-[20px] font-medium leading-[1.2]">
            Your account
          </h1>
          <p className="m-0 text-[12px] leading-[1.55] text-neutral-400">
            Your handle is public. Your email is private and is only used to send
            sign-in links and to contact you about your account.
          </p>
        </div>

        <section className="rounded-[2px] border border-neutral-800 bg-surface p-4">
          <dl className="m-0 grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[12px]">
            <dt className="text-neutral-500">Handle</dt>
            <dd className="m-0 text-neutral-100">
              {user.handle ? `@${user.handle}` : 'Not chosen yet'}
            </dd>
            <dt className="text-neutral-500">Email</dt>
            <dd className="m-0 break-all text-neutral-100">{user.email ?? '—'}</dd>
            <dt className="text-neutral-500">Member since</dt>
            <dd className="m-0 text-neutral-100">{joined(user.createdAt)}</dd>
          </dl>
          {!user.handle && (
            <p className="m-0 mt-3 text-[11px] text-neutral-400">
              You need a handle before you can publish, comment, annotate or vote.{' '}
              <Link href="/onboarding">Choose one</Link>.
            </p>
          )}
          {user.suspendedAt && (
            <p className="m-0 mt-3 border-t border-neutral-800 pt-3 text-[11px] text-danger">
              Your account is suspended, so you can read but not post or change content.
            </p>
          )}
        </section>

        <AccountSettings handle={user.handle} />

        <p className="m-0 text-[11px] leading-[1.6] text-neutral-500">
          By using OpenWeightModels you agree to the <Link href="/terms">Terms of Service</Link>{' '}
          and the <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </main>
    </div>
  );
}

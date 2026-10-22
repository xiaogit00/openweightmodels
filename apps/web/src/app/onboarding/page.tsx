import { redirect } from 'next/navigation';
import { HandleForm } from '@/components/handle-form';
import { SiteHeader } from '@/components/site-header';
import { getCurrentUser } from '@/lib/auth';
import { safeNextPath, signInPath } from '@/lib/next-path';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Choose a handle — OpenWeightModels',
  robots: { index: false, follow: false },
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeNextPath(Array.isArray(query.next) ? query.next[0] : query.next);
  const user = await getCurrentUser();

  if (!user) redirect(signInPath(`/onboarding?next=${encodeURIComponent(next)}`));
  if (user.handle) redirect(next);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader handle={null} signedIn variant="page" showNew={false} />
      <main className="mx-auto flex w-full max-w-[440px] flex-col gap-5 px-5 py-12">
        <div className="flex flex-col gap-1.5">
          <span className="micro-label uppercase">One more step</span>
          <h1 className="m-0 font-heading text-[20px] font-medium leading-[1.2]">
            Choose your handle
          </h1>
          <p className="m-0 text-[12px] leading-[1.55] text-neutral-400">
            Your handle is your public identity on the Board. You can read without one,
            but you need a handle to publish, annotate, comment or vote.
          </p>
        </div>
        <div className="rounded-[2px] border border-neutral-800 bg-surface p-4">
          <HandleForm next={next} />
        </div>
      </main>
    </div>
  );
}

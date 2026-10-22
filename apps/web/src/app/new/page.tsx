import { getModels, resolveMaxChallengers } from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { NewComparisonClient } from '@/components/new-comparison-client';
import { SiteHeader } from '@/components/site-header';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'New comparison — OpenWeightModels',
};

export default async function NewComparisonPage() {
  const [user, models] = await Promise.all([getCurrentUser(), getModels()]);

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader handle="guest" variant="page" showNew={false} />
        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-2 px-5 py-8">
          <h1 className="m-0 font-heading text-[18px] font-medium leading-[1.2]">
            New comparison
          </h1>
          <p className="text-[12px] text-neutral-400">
            Sign in to upload a base output and schedule a comparison.
          </p>
        </main>
      </div>
    );
  }

  return (
    <NewComparisonClient
      handle={user.handle}
      maxChallengers={resolveMaxChallengers(process.env.MAX_CHALLENGERS)}
      models={models.map((model) => ({
        id: model.id,
        slug: model.slug,
        displayName: model.displayName,
        monogram: model.monogram,
        etaSeconds: model.etaSeconds,
      }))}
    />
  );
}

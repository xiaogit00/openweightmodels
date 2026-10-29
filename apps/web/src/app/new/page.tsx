import { redirect } from 'next/navigation';
import { getModels, resolveMaxChallengers } from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { signInPath } from '@/lib/next-path';
import { NewComparisonClient } from '@/components/new-comparison-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'New comparison — OpenWeightModels',
};

export default async function NewComparisonPage() {
  const [user, models] = await Promise.all([getCurrentUser(), getModels()]);

  if (!user) redirect(signInPath('/new'));
  if (!user.handle) redirect(`/onboarding?next=${encodeURIComponent('/new')}`);

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
        openWeights: model.openWeights,
      }))}
    />
  );
}

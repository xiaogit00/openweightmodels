import { redirect } from 'next/navigation';
import {
  getModels,
  listCategories,
  parseModelClassTab,
  resolveMaxChallengers,
} from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { signInPath } from '@/lib/next-path';
import { NewComparisonClient } from '@/components/new-comparison-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'New comparison — OpenWeightModels',
};

export default async function NewComparisonPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, models, categories, query] = await Promise.all([
    getCurrentUser(),
    getModels(),
    listCategories(),
    searchParams,
  ]);

  if (!user) redirect(signInPath('/new'));
  if (!user.handle) redirect(`/onboarding?next=${encodeURIComponent('/new')}`);

  const classParam = Array.isArray(query.class) ? query.class[0] : query.class;

  return (
    <NewComparisonClient
      handle={user.handle}
      maxChallengers={resolveMaxChallengers(process.env.MAX_CHALLENGERS)}
      initialClass={parseModelClassTab(classParam)}
      categoryLibrary={categories}
      models={models.map((model) => ({
        id: model.id,
        slug: model.slug,
        displayName: model.displayName,
        monogram: model.monogram,
        etaSeconds: model.etaSeconds,
        provider: model.provider,
        publisher: model.publisher,
        openWeights: model.openWeights,
        family: model.family,
        weightClass: model.weightClass,
        runSizeGb: model.runSizeGb,
        totalParams: model.totalParams,
        activeParams: model.activeParams,
      }))}
    />
  );
}

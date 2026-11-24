import { notFound, redirect } from 'next/navigation';
import { getComparisonForViewer, listCategories } from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { signInPath } from '@/lib/next-path';
import { EditComparisonClient } from '@/components/edit-comparison-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Edit details — OpenWeightModels',
  robots: { index: false, follow: false },
};

export default async function EditComparisonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(signInPath(`/comparisons/${id}/edit`));

  const [bundle, library] = await Promise.all([
    getComparisonForViewer(id, user.id, user.role === 'admin'),
    listCategories(),
  ]);
  if (!bundle || bundle.comparison.authorId !== user.id || bundle.comparison.deletedAt) {
    notFound();
  }

  return (
    <EditComparisonClient
      comparison={{
        id: bundle.comparison.id,
        title: bundle.comparison.title,
        categories: bundle.categories,
        effort: bundle.comparison.effort,
      }}
      library={library}
      handle={user.handle ?? user.id.slice(0, 8)}
    />
  );
}

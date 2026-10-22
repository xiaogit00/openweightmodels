import { notFound } from 'next/navigation';
import { getJobForComparisonForAuthor } from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { JobSummary } from '@/components/job-summary';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Job — OpenWeightModels',
  robots: { index: false, follow: false },
};

export default async function ComparisonJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const bundle = await getJobForComparisonForAuthor(id, user?.id ?? null);
  if (!bundle) notFound();

  return <JobSummary bundle={bundle} />;
}

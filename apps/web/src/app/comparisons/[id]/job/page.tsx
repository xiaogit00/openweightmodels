import { notFound } from 'next/navigation';
import { getJobForComparisonForAuthor } from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { JobSummary, type JobView } from '@/components/job-summary';

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

  const view: JobView = {
    jobId: bundle.job.id,
    jobStatus: bundle.job.status,
    scheduledAt: bundle.job.createdAt.toISOString().slice(11, 16),
    comparison: {
      id: bundle.comparison.id,
      title: bundle.comparison.title,
      categories: bundle.comparison.categories,
      effort: bundle.comparison.effort,
      status: bundle.comparison.status,
    },
    authorHandle: bundle.author.handle,
    baseModel: bundle.baseModel
      ? { name: bundle.baseModel.name, monogram: bundle.baseModel.monogram }
      : null,
    baseSnippet: bundle.baseSnippet,
    challengerSnippet: bundle.challengerSnippet,
    runs: bundle.runs,
  };

  return <JobSummary view={view} />;
}

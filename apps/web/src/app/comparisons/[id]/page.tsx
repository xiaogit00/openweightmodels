import { notFound } from 'next/navigation';
import {
  buildBlocks,
  getAnnotationViews,
  getCommentViews,
  getComparisonForViewer,
  getModels,
} from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { ComparisonView } from '@/components/comparison-view';

export const dynamic = 'force-dynamic';

export default async function ComparisonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const user = await getCurrentUser();
  const bundle = await getComparisonForViewer(id, user?.id ?? null);
  if (!bundle) notFound();

  const [annotations, comments, models] = await Promise.all([
    getAnnotationViews(id, user?.id ?? null),
    getCommentViews(id, user?.id ?? null),
    getModels(),
  ]);

  const modelParam = Array.isArray(query.model) ? query.model[0] : query.model;
  const annParam = Array.isArray(query.annotations)
    ? query.annotations[0]
    : query.annotations;

  return (
    <ComparisonView
      comparison={{
        id: bundle.comparison.id,
        title: bundle.comparison.title,
        prompt: bundle.comparison.prompt,
        categories: bundle.comparison.categories,
        effort: bundle.comparison.effort,
        status: bundle.comparison.status,
        createdAt: bundle.comparison.createdAt.toISOString(),
        publishedAt: bundle.comparison.publishedAt?.toISOString() ?? null,
        authorId: bundle.comparison.authorId,
      }}
      author={bundle.author}
      baseModel={{
        slug: bundle.baseModel.slug,
        name: bundle.baseModel.displayName,
        monogram: bundle.baseModel.monogram,
      }}
      responses={bundle.responses.map(({ response, model }) => ({
        id: response.id,
        isBase: response.isBase,
        contentMd: response.contentMd,
        tokens: response.tokens,
        latencyMs: response.latencyMs,
        status: response.status,
        error: response.error,
        model: {
          slug: model.slug,
          name: model.displayName,
          monogram: model.monogram,
        },
        blocks: response.status === 'done' ? buildBlocks(response.contentMd) : [],
      }))}
      annotations={annotations}
      comments={comments}
      models={models.map((model) => ({
        id: model.id,
        slug: model.slug,
        name: model.displayName,
        monogram: model.monogram,
      }))}
      currentUserId={user?.handle ? user.id : null}
      viewerSignedIn={user !== null}
      initialModel={modelParam ?? null}
      initialAnnOn={annParam === '1' || annParam === 'true'}
      handle={user?.handle ?? null}
    />
  );
}

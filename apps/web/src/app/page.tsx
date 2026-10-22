import {
  getBoardFacets,
  getModels,
  listComparisons,
  parseBoardFilters,
  recentActivity,
} from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { BoardClient } from '@/components/board-client';

export const dynamic = 'force-dynamic';

function searchParamsFromRecord(
  record: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, entry);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  return params;
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const record = await searchParams;
  const initialFilters = parseBoardFilters(searchParamsFromRecord(record));

  const [user, page, facets, models, events] = await Promise.all([
    getCurrentUser(),
    listComparisons({
      cat: initialFilters.cat,
      models: initialFilters.models,
      effort: initialFilters.effort,
      q: initialFilters.q,
      sort: initialFilters.sort,
    }),
    getBoardFacets(),
    getModels(),
    recentActivity(24),
  ]);

  return (
    <BoardClient
      initialPage={page}
      initialFacets={facets}
      models={models.map((model) => ({
        id: model.id,
        slug: model.slug,
        displayName: model.displayName,
        monogram: model.monogram,
        etaSeconds: model.etaSeconds,
      }))}
      events={events.map((event) => ({
        id: event.id,
        kind: event.kind,
        summary: event.summary,
        createdAt: event.createdAt.toISOString(),
      }))}
      handle={user?.handle ?? 'guest'}
      initialFilters={initialFilters}
    />
  );
}

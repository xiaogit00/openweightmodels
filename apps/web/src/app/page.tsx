import { getModels, listComparisons, recentActivity, type BoardFilters, type Sort } from '@owm/core';
import { getCurrentUser } from '@/lib/auth';
import { BoardClient } from '@/components/board-client';

export const dynamic = 'force-dynamic';

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [user, list, models, events] = await Promise.all([
    getCurrentUser(),
    listComparisons({ limit: 100, sort: 'live' }),
    getModels(),
    recentActivity(24),
  ]);

  const effortRaw = one(params.effort);
  const effort = effortRaw ? Number(effortRaw) : null;
  const sortRaw = one(params.sort);
  const sort: Sort =
    sortRaw === 'top' || sortRaw === 'new' || sortRaw === 'live' ? sortRaw : 'live';

  const initialFilters: BoardFilters = {
    cat: one(params.cat) ?? 'All',
    models: (one(params.models) ?? '').split(',').filter(Boolean),
    effort: effort && [1, 2, 3].includes(effort) ? effort : null,
    q: one(params.q) ?? '',
    sort,
  };

  return (
    <BoardClient
      initialCards={list.items}
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

import { CATEGORIES, EFFORT_LEVELS, SORTS } from './types';
import type { BoardFacets, BoardFilters, ComparisonCard } from './types';

/**
 * Both the first page and every infinite-scroll page use this size. The API
 * clamps `limit` to 100, so this is also the largest normal page.
 */
export const BOARD_PAGE_SIZE = 48;

/** Arrivals within this distance of the top may move the grid under the reader. */
export const ARRIVAL_NEAR_TOP_PX = 200;

/**
 * Live and New both put a fresh publish at the top, so near-top readers can
 * take the insertion. Top must never reorder in place, and any scrolled reader
 * gets the pill instead of content moving under them.
 */
export function arrivalPlacement(
  sort: BoardFilters['sort'],
  scrollY: number,
): 'insert' | 'queue' {
  if (scrollY >= ARRIVAL_NEAR_TOP_PX) return 'queue';
  return sort === 'top' ? 'queue' : 'insert';
}

export function topScore(card: Pick<ComparisonCard, 'commentCount' | 'annotationCount'>) {
  return card.commentCount + 2 * card.annotationCount;
}

export function matchesFilters(card: ComparisonCard, filters: BoardFilters) {
  const query = filters.q.trim().toLowerCase();

  if (filters.cat !== 'All' && !card.categories.includes(filters.cat)) return false;
  if (filters.models.length) {
    const slugs = new Set(card.models.map((model) => model.slug));
    if (!filters.models.some((slug) => slugs.has(slug))) return false;
  }
  if (filters.effort !== null && card.effort !== filters.effort) return false;
  if (query) {
    const haystack = [card.title, ...card.models.map((model) => model.name)]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

export function filterCards(cards: ComparisonCard[], filters: BoardFilters) {
  return cards.filter((card) => matchesFilters(card, filters));
}

/**
 * Appends a page without letting an overlapping keyset window duplicate cards.
 * Existing order is preserved so a live arrival does not jump the reader.
 */
export function appendUniqueCards(
  current: ComparisonCard[],
  incoming: ComparisonCard[],
): ComparisonCard[] {
  const seen = new Set(current.map((card) => card.id));
  const appended = incoming.filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
  return appended.length ? [...current, ...appended] : current;
}

export function emptyBoardFacets(): BoardFacets {
  return {
    categories: Object.fromEntries(CATEGORIES.map((category) => [category, 0])),
    models: {},
    total: 0,
  };
}

/** Applies one newly published card to the global sidebar counts. */
export function addCardToFacets(facets: BoardFacets, card: ComparisonCard): BoardFacets {
  const categories = { ...facets.categories };
  for (const category of new Set(card.categories)) {
    categories[category] = (categories[category] ?? 0) + 1;
  }

  const models = { ...facets.models };
  for (const slug of new Set(card.models.map((model) => model.slug))) {
    models[slug] = (models[slug] ?? 0) + 1;
  }

  return { categories, models, total: facets.total + 1 };
}

const knownCategories = new Set<string>(CATEGORIES);
const knownSorts = new Set<string>(SORTS);

/** Turns a URL (or the API query string) into validated Board state. */
export function parseBoardFilters(params: URLSearchParams): BoardFilters {
  const category = params.get('cat') ?? 'All';
  const models = [
    ...new Set(
      (params.get('models') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const effortValue = Number(params.get('effort'));
  const sortValue = params.get('sort') ?? 'live';

  return {
    cat: knownCategories.has(category) ? category : 'All',
    models,
    effort: EFFORT_LEVELS.some((level) => level.value === effortValue) ? effortValue : null,
    q: params.get('q') ?? '',
    sort: knownSorts.has(sortValue) ? (sortValue as BoardFilters['sort']) : 'live',
  };
}

/** Defaults are omitted so a pristine Board has a clean URL. */
export function boardFiltersToSearchParams(filters: BoardFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.cat !== 'All') params.set('cat', filters.cat);
  if (filters.models.length) params.set('models', filters.models.join(','));
  if (filters.effort !== null) params.set('effort', String(filters.effort));
  if (filters.sort !== 'live') params.set('sort', filters.sort);
  if (filters.q) params.set('q', filters.q);
  return params;
}

/**
 * Canonical identity for a view. Model order and surrounding search whitespace
 * do not change the result, so they must not trigger a refetch or a history
 * entry.
 */
export function boardFiltersKey(filters: BoardFilters): string {
  return boardFiltersToSearchParams({
    ...filters,
    models: [...filters.models].sort(),
    q: filters.q.trim(),
  }).toString();
}

export function sortCards(cards: ComparisonCard[], sort: BoardFilters['sort']) {
  const copy = [...cards];
  if (sort === 'top') {
    copy.sort((a, b) => {
      const score = topScore(b) - topScore(a);
      if (score !== 0) return score;
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    });
  } else if (sort === 'new') {
    copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } else {
    copy.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }
  return copy;
}

export function categoryCounts(cards: ComparisonCard[]) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const category of card.categories) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return counts;
}

export function modelCounts(cards: ComparisonCard[]) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const model of card.models) {
      counts.set(model.slug, (counts.get(model.slug) ?? 0) + 1);
    }
  }
  return counts;
}

export function relativeTime(value: string | Date, now = Date.now()) {
  const then = typeof value === 'string' ? Date.parse(value) : value.getTime();
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** The same label with the suffix the UI shows: "just now", "2m ago". */
export function relativeTimeAgo(value: string | Date, now = Date.now()) {
  const label = relativeTime(value, now);
  return label === 'just now' ? label : `${label} ago`;
}

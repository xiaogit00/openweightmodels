import type { BoardFilters, ComparisonCard } from './types';

export function topScore(card: Pick<ComparisonCard, 'commentCount' | 'annotationCount'>) {
  return card.commentCount + 2 * card.annotationCount;
}

export function filterCards(cards: ComparisonCard[], filters: BoardFilters) {
  const query = filters.q.trim().toLowerCase();

  return cards.filter((card) => {
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
  });
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

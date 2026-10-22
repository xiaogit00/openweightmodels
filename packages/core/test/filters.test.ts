import { describe, expect, it } from 'vitest';
import {
  categoryCounts,
  filterCards,
  modelCounts,
  relativeTime,
  sortCards,
  topScore,
} from '../src/domain/filters';
import type { BoardFilters, ComparisonCard } from '../src/domain/types';

function card(overrides: Partial<ComparisonCard> & { id: string }): ComparisonCard {
  return {
    title: `Comparison ${overrides.id}`,
    categories: ['Coding'],
    effort: 1,
    models: [
      { id: 'm-llama', slug: 'llama-3-3-70b', name: 'Llama 3.3 70B', monogram: 'L3' },
    ],
    baseSnippet: '',
    challengerSnippet: '',
    commentCount: 0,
    annotationCount: 0,
    author: { handle: 'mira', avatarUrl: null },
    publishedAt: '2026-10-22T10:00:00.000Z',
    createdAt: '2026-10-22T09:00:00.000Z',
    ...overrides,
  };
}

const noFilters: BoardFilters = {
  cat: 'All',
  models: [],
  effort: null,
  q: '',
  sort: 'live',
};

const cards = [
  card({
    id: 'a',
    title: 'Rate limiter in Go',
    categories: ['Coding'],
    effort: 2,
    models: [
      { id: 'm-llama', slug: 'llama-3-3-70b', name: 'Llama 3.3 70B', monogram: 'L3' },
      { id: 'm-qwen', slug: 'qwen-2-5-72b', name: 'Qwen2.5 72B', monogram: 'Q2' },
    ],
    commentCount: 3,
    annotationCount: 1,
    publishedAt: '2026-10-22T10:00:00.000Z',
    createdAt: '2026-10-22T08:00:00.000Z',
  }),
  card({
    id: 'b',
    title: 'Rewrite the Monty Hall explanation',
    categories: ['Reasoning'],
    effort: 1,
    models: [
      { id: 'm-qwen', slug: 'qwen-2-5-72b', name: 'Qwen2.5 72B', monogram: 'Q2' },
    ],
    commentCount: 9,
    annotationCount: 2,
    publishedAt: '2026-10-22T11:00:00.000Z',
    createdAt: '2026-10-22T09:00:00.000Z',
  }),
  card({
    id: 'c',
    title: 'A haiku about tides',
    categories: ['Creative', 'Language'],
    effort: 3,
    models: [
      { id: 'm-gemma', slug: 'gemma-2-27b', name: 'Gemma 2 27B', monogram: 'G2' },
    ],
    commentCount: 1,
    annotationCount: 0,
    publishedAt: '2026-10-22T12:00:00.000Z',
    createdAt: '2026-10-22T10:00:00.000Z',
  }),
];

describe('filterCards', () => {
  it('returns every card when no filter is set', () => {
    expect(filterCards(cards, noFilters).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters by Category', () => {
    expect(
      filterCards(cards, { ...noFilters, cat: 'Reasoning' }).map((item) => item.id),
    ).toEqual(['b']);
    expect(
      filterCards(cards, { ...noFilters, cat: 'Creative' }).map((item) => item.id),
    ).toEqual(['c']);
  });

  it('treats multiple selected models as OR', () => {
    expect(
      filterCards(cards, {
        ...noFilters,
        models: ['gemma-2-27b', 'llama-3-3-70b'],
      }).map((item) => item.id),
    ).toEqual(['a', 'c']);
  });

  it('filters by effort', () => {
    expect(filterCards(cards, { ...noFilters, effort: 1 }).map((item) => item.id)).toEqual([
      'b',
    ]);
  });

  it('searches titles and model names case-insensitively', () => {
    expect(filterCards(cards, { ...noFilters, q: 'MONTY' }).map((item) => item.id)).toEqual([
      'b',
    ]);
    expect(
      filterCards(cards, { ...noFilters, q: 'gemma' }).map((item) => item.id),
    ).toEqual(['c']);
    expect(filterCards(cards, { ...noFilters, q: '  rate  ' }).map((item) => item.id)).toEqual([
      'a',
    ]);
  });

  it('applies combined filters with AND', () => {
    expect(
      filterCards(cards, {
        ...noFilters,
        cat: 'Coding',
        effort: 2,
        models: ['qwen-2-5-72b'],
        q: 'limiter',
      }).map((item) => item.id),
    ).toEqual(['a']);
    expect(
      filterCards(cards, { ...noFilters, cat: 'Coding', effort: 3 }).map((item) => item.id),
    ).toEqual([]);
  });
});

describe('sortCards', () => {
  it('sorts Top by comments plus double the annotations', () => {
    expect(topScore(cards[0]!)).toBe(5);
    expect(sortCards(cards, 'top').map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('breaks a Top tie by most recently published', () => {
    const tied = [
      card({ id: 'older', commentCount: 2, publishedAt: '2026-10-20T10:00:00.000Z' }),
      card({ id: 'newer', annotationCount: 1, publishedAt: '2026-10-21T10:00:00.000Z' }),
    ];
    expect(sortCards(tied, 'top').map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('sorts New by creation time', () => {
    expect(sortCards(cards, 'new').map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts Live by publish time', () => {
    expect(sortCards(cards, 'live').map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [...cards];
    sortCards(input, 'top');
    expect(input.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('sidebar counts', () => {
  it('counts every Category on a card', () => {
    expect(Object.fromEntries(categoryCounts(cards))).toEqual({
      Coding: 1,
      Reasoning: 1,
      Creative: 1,
      Language: 1,
    });
  });

  it('counts every distinct Model on a card', () => {
    expect(Object.fromEntries(modelCounts(cards))).toEqual({
      'llama-3-3-70b': 1,
      'qwen-2-5-72b': 2,
      'gemma-2-27b': 1,
    });
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-22T12:00:00.000Z');

  it('reports recent and future timestamps as just now', () => {
    expect(relativeTime('2026-10-22T11:59:30.000Z', now)).toBe('just now');
    expect(relativeTime('2026-10-22T12:05:00.000Z', now)).toBe('just now');
  });

  it('steps through minutes, hours and days', () => {
    expect(relativeTime('2026-10-22T11:30:00.000Z', now)).toBe('30m');
    expect(relativeTime('2026-10-22T09:00:00.000Z', now)).toBe('3h');
    expect(relativeTime('2026-10-19T12:00:00.000Z', now)).toBe('3d');
  });
});

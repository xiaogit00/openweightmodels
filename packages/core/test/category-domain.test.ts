import { describe, expect, it } from 'vitest';
import {
  PRESET_CATEGORIES,
  categoryNameError,
  categorySlug,
  normaliseCategoryName,
  rankCategoryOptions,
  type CategoryOption,
} from '../src/domain/categories';

describe('category slugs', () => {
  it('treats case, spaces and punctuation as one identity', () => {
    expect(categorySlug('Front-end')).toBe('front-end');
    expect(categorySlug('Front end')).toBe('front-end');
    expect(categorySlug('  FRONT   END  ')).toBe('front-end');
    expect(categorySlug('Front_end')).toBe('front-end');
  });

  it('keeps preset slugs stable', () => {
    expect(PRESET_CATEGORIES.map((entry) => entry.slug)).toEqual([
      'coding',
      'reasoning',
      'creative',
      'math',
      'long-context',
      'language',
      'agents',
      'tool-use',
      'data-analysis',
      'translation',
      'security',
      'roleplay',
    ]);
  });

  it('strips accents rather than dropping the letter', () => {
    expect(categorySlug('Café')).toBe('cafe');
  });

  it('returns an empty slug for punctuation-only names', () => {
    expect(categorySlug('++')).toBe('');
  });
});

describe('category names', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normaliseCategoryName('  Front   end ')).toBe('Front end');
  });

  it('requires 2 to 24 characters after normalising', () => {
    expect(categoryNameError('a')).toBeTruthy();
    expect(categoryNameError('  a  ')).toBeTruthy();
    expect(categoryNameError('ab')).toBeNull();
    expect(categoryNameError('a'.repeat(24))).toBeNull();
    expect(categoryNameError('a'.repeat(25))).toBeTruthy();
  });

  it('rejects names that cannot make a slug', () => {
    expect(categoryNameError('++')).toBeTruthy();
  });
});

function option(overrides: Partial<CategoryOption> & { slug: string; name: string }): CategoryOption {
  return { featured: false, count: 0, ...overrides };
}

describe('category ranking', () => {
  const options = [
    option({ slug: 'coding', name: 'Coding', featured: true, count: 12 }),
    option({ slug: 'code-review', name: 'Code review', count: 4 }),
    option({ slug: 'sql', name: 'SQL', count: 9 }),
    option({ slug: 'front-end', name: 'Front-end', count: 2 }),
    option({ slug: 'frontend', name: 'Frontend', count: 1 }),
    option({ slug: 'review-lab', name: 'Review lab', count: 0 }),
  ];

  it('browses by comparison count, with own new categories first', () => {
    const ranked = rankCategoryOptions(options, '', {
      own: [{ slug: 'shell', name: 'Shell' }],
    });
    expect(ranked.map((entry) => entry.slug)).toEqual([
      'shell',
      'coding',
      'sql',
      'code-review',
      'front-end',
      'frontend',
      'review-lab',
    ]);
  });

  it('ranks prefix matches before a more-used substring match', () => {
    expect(rankCategoryOptions(options, 'review').map((entry) => entry.slug)).toEqual([
      'review-lab',
      'code-review',
    ]);
    expect(rankCategoryOptions(options, 'cod').map((entry) => entry.slug)).toEqual([
      'coding',
      'code-review',
    ]);
  });

  it('matches presets and community together', () => {
    const ranked = rankCategoryOptions(options, 'front');
    expect(ranked.map((entry) => entry.slug)).toEqual(['front-end', 'frontend']);
  });

  it('returns nothing when the query matches nothing', () => {
    expect(rankCategoryOptions(options, 'zzz')).toEqual([]);
  });
});

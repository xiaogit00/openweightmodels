/**
 * Categories are entities with stable slugs (ADR 0012). The curated presets
 * live in code so a deploy can sync them additively; community Categories live
 * only in the database. This module is client-safe: the Board and the Step 3
 * combobox both rank and validate Categories with the same rules the server
 * enforces.
 */

export type CategoryRef = {
  slug: string;
  name: string;
};

export type CategoryOption = CategoryRef & {
  featured: boolean;
  /** Published Comparisons carrying this Category. */
  count: number;
};

/** Where a selected Category came from, for the NEW tag and the caps. */
export type SelectedCategory = CategoryRef & {
  featured: boolean;
  /** Created in this form session, so it has no library count yet. */
  isNew: boolean;
};

export const PRESET_CATEGORIES = [
  { slug: 'coding', name: 'Coding' },
  { slug: 'reasoning', name: 'Reasoning' },
  { slug: 'creative', name: 'Creative' },
  { slug: 'math', name: 'Math' },
  { slug: 'long-context', name: 'Long-context' },
  { slug: 'language', name: 'Language' },
  { slug: 'agents', name: 'Agents' },
  { slug: 'tool-use', name: 'Tool use' },
  { slug: 'data-analysis', name: 'Data analysis' },
  { slug: 'translation', name: 'Translation' },
  { slug: 'security', name: 'Security' },
  { slug: 'roleplay', name: 'Roleplay' },
] as const;

export const CATEGORY_NAME_MIN_LENGTH = 2;
export const CATEGORY_NAME_MAX_LENGTH = 24;
export const MAX_NEW_CATEGORIES_PER_COMPARISON = 3;
export const MAX_CATEGORIES_PER_COMPARISON = 6;

/**
 * A stable, punctuation- and case-insensitive identity. "Front-end", "Front
 * end" and "front_end" all collide on `front-end`, so near-duplicates cannot
 * both exist; the display name keeps the Author's casing.
 */
export function categorySlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Trim the ends and collapse every internal whitespace run to one space. */
export function normaliseCategoryName(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/** `null` when the name is acceptable; otherwise the message the field shows. */
export function categoryNameError(value: string): string | null {
  const name = normaliseCategoryName(value);
  if (name.length < CATEGORY_NAME_MIN_LENGTH || name.length > CATEGORY_NAME_MAX_LENGTH) {
    return 'Categories need 2–24 characters.';
  }
  if (!categorySlug(name)) {
    return 'Use at least one letter or number.';
  }
  return null;
}

/**
 * Options for the combobox. An empty query browses: the Author's own new names
 * first, then the most-used Categories. A query ranks prefix matches ahead of
 * substring matches before falling back to count, so typing a name the Author
 * is likely looking for puts it on the first row.
 */
export function rankCategoryOptions(
  options: CategoryOption[],
  query: string,
  { own = [] }: { own?: CategoryRef[] } = {},
): Array<CategoryOption & { isNew?: boolean }> {
  const ownOptions: Array<CategoryOption & { isNew: boolean }> = own.map((entry) => ({
    ...entry,
    featured: false,
    count: 0,
    isNew: true,
  }));
  const all: Array<CategoryOption & { isNew?: boolean }> = [...ownOptions, ...options];
  const needle = normaliseCategoryName(query).toLowerCase();
  if (!needle) {
    return all.sort(
      (left, right) =>
        Number(Boolean(right.isNew)) - Number(Boolean(left.isNew)) ||
        right.count - left.count ||
        left.name.localeCompare(right.name),
    );
  }
  const slugNeedle = categorySlug(needle);

  return all
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        (slugNeedle.length > 0 && entry.slug.includes(slugNeedle)),
    )
    .sort((left, right) => {
      const leftPrefix = left.name.toLowerCase().startsWith(needle) ? 1 : 0;
      const rightPrefix = right.name.toLowerCase().startsWith(needle) ? 1 : 0;
      return (
        rightPrefix - leftPrefix ||
        right.count - left.count ||
        left.name.localeCompare(right.name)
      );
    });
}

/** True when a Category with this display name is already in the selection. */
export function selectionHasSlug(
  selection: Array<Pick<CategoryRef, 'slug'>>,
  slug: string,
): boolean {
  return selection.some((entry) => entry.slug === slug);
}

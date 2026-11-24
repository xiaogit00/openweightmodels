import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb, type Db } from '../db/client';
import { categories, comparisonCategories, comparisons } from '../db/schema';
import {
  MAX_CATEGORIES_PER_COMPARISON,
  MAX_NEW_CATEGORIES_PER_COMPARISON,
  PRESET_CATEGORIES,
  categoryNameError,
  categorySlug,
  normaliseCategoryName,
  type CategoryOption,
  type CategoryRef,
} from '../domain/categories';
import { DomainError, conflict } from './errors';

/** The subset of the database client a transaction also satisfies. */
type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

export type CategorySelection = {
  /** The final ordered selection, using an existing Category's display name. */
  refs: CategoryRef[];
  /** Names that do not exist yet and would be created on publish. */
  newNames: string[];
};

export type CategoryRow = {
  id: string;
  slug: string;
  displayName: string;
  featured: boolean;
};

/**
 * Validates an ordered selection of Category names. The caller supplies names,
 * not ids, because a draft may name a Category that does not exist yet. Caps
 * are enforced here, at the service boundary, so no route can skip them.
 */
export async function resolveCategorySelection(
  input: string[],
  db: Db = getDb(),
): Promise<CategorySelection> {
  const names = input.map(normaliseCategoryName);
  const seen = new Map<string, string>();
  for (const name of names) {
    const error = categoryNameError(name);
    if (error) throw new DomainError('invalid_category_name', error, 400);
    const slug = categorySlug(name);
    if (seen.has(slug)) {
      throw conflict(
        'duplicate_category',
        `“${name}” is already selected; each Category can appear once.`,
      );
    }
    seen.set(slug, name);
  }

  if (names.length > MAX_CATEGORIES_PER_COMPARISON) {
    throw conflict(
      'too_many_categories',
      `A comparison can have at most ${MAX_CATEGORIES_PER_COMPARISON} Categories.`,
    );
  }

  const slugs = [...seen.keys()];
  const lowered = [...seen.values()].map((name) => name.toLowerCase());
  const existingRows = slugs.length
    ? await db
        .select({
          id: categories.id,
          slug: categories.slug,
          displayName: categories.displayName,
        })
        .from(categories)
        .where(
          or(
            inArray(categories.slug, slugs),
            // A rename keeps the stable slug, so the form's current display
            // name is still an identity. Without this fallback an edit after a
            // rename would fork a duplicate.
            inArray(sql`lower(${categories.displayName})`, lowered),
          ),
        )
    : [];
  const existingBySlug = new Map(existingRows.map((row) => [row.slug, row]));
  const existingByName = new Map(
    existingRows.map((row) => [row.displayName.toLowerCase(), row]),
  );

  const refs: CategoryRef[] = [];
  const newNames: string[] = [];
  for (const [slug, name] of seen) {
    const match = existingBySlug.get(slug) ?? existingByName.get(name.toLowerCase());
    if (match) {
      refs.push({ slug: match.slug, name: match.displayName });
    } else {
      refs.push({ slug, name });
      newNames.push(name);
    }
  }

  if (newNames.length > MAX_NEW_CATEGORIES_PER_COMPARISON) {
    throw conflict(
      'too_many_new_categories',
      `You can create up to ${MAX_NEW_CATEGORIES_PER_COMPARISON} new Categories per comparison.`,
    );
  }

  return { refs, newNames };
}

/** Finds a Category by slug or creates it as a community Category. */
async function findOrCreateCategory(
  executor: Executor,
  entry: { name: string; slug: string; createdBy: string | null },
): Promise<CategoryRow> {
  const [existing] = await executor
    .select({
      id: categories.id,
      slug: categories.slug,
      displayName: categories.displayName,
      featured: categories.featured,
    })
    .from(categories)
    .where(eq(categories.slug, entry.slug))
    .limit(1);
  if (existing) return existing;

  // A Category renamed after a draft stored its old display name still exists
  // under its stable slug; match the current name before creating a duplicate.
  const [renamed] = await executor
    .select({
      id: categories.id,
      slug: categories.slug,
      displayName: categories.displayName,
      featured: categories.featured,
    })
    .from(categories)
    .where(sql`lower(${categories.displayName}) = lower(${entry.name})`)
    .limit(1);
  if (renamed) return renamed;

  const [inserted] = await executor
    .insert(categories)
    .values({
      id: uuidv7(),
      slug: entry.slug,
      displayName: entry.name,
      featured: false,
      createdBy: entry.createdBy,
    })
    .onConflictDoNothing({ target: categories.slug })
    .returning({
      id: categories.id,
      slug: categories.slug,
      displayName: categories.displayName,
      featured: categories.featured,
    });
  if (inserted) return inserted;

  // Two Comparisons published the same name at once; the unique slug index
  // picked a winner and this request joins it instead of forking a duplicate.
  const [raced] = await executor
    .select({
      id: categories.id,
      slug: categories.slug,
      displayName: categories.displayName,
      featured: categories.featured,
    })
    .from(categories)
    .where(
      or(
        eq(categories.slug, entry.slug),
        sql`lower(${categories.displayName}) = lower(${entry.name})`,
      ),
    )
    .limit(1);
  if (!raced) throw new Error(`category ${entry.slug} disappeared while creating it`);
  return raced;
}

/**
 * Turns a draft's pending names into real Category rows and join rows. This is
 * the only place a draft's Categories are created, so abandoning a draft leaves
 * nothing behind.
 */
export async function materialisePendingCategories(
  executor: Executor,
  { comparisonId, authorId }: { comparisonId: string; authorId: string },
): Promise<void> {
  const [row] = await executor
    .select({ pending: comparisons.pendingCategories })
    .from(comparisons)
    .where(eq(comparisons.id, comparisonId))
    .limit(1);
  const pending = row?.pending ?? [];
  if (!pending.length) return;

  const values: Array<{
    comparisonId: string;
    categoryId: string;
    position: number;
  }> = [];
  for (const [position, name] of pending.entries()) {
    const category = await findOrCreateCategory(executor, {
      name,
      slug: categorySlug(name),
      createdBy: authorId,
    });
    values.push({ comparisonId, categoryId: category.id, position });
  }

  await executor
    .delete(comparisonCategories)
    .where(eq(comparisonCategories.comparisonId, comparisonId));
  await executor.insert(comparisonCategories).values(values).onConflictDoNothing();
  await executor
    .update(comparisons)
    .set({ pendingCategories: [] })
    .where(eq(comparisons.id, comparisonId));
}

/**
 * Replaces an already-published Comparison's Categories in one transaction.
 * A community Category created here exists immediately because the Comparison
 * is public already.
 */
export async function replaceComparisonCategories(
  executor: Executor,
  {
    comparisonId,
    authorId,
    refs,
  }: { comparisonId: string; authorId: string; refs: CategoryRef[] },
): Promise<void> {
  const values: Array<{
    comparisonId: string;
    categoryId: string;
    position: number;
  }> = [];
  for (const [position, ref] of refs.entries()) {
    const category = await findOrCreateCategory(executor, {
      name: ref.name,
      slug: ref.slug,
      createdBy: authorId,
    });
    values.push({ comparisonId, categoryId: category.id, position });
  }

  await executor
    .delete(comparisonCategories)
    .where(eq(comparisonCategories.comparisonId, comparisonId));
  if (values.length) await executor.insert(comparisonCategories).values(values);
  await executor
    .update(comparisons)
    .set({ pendingCategories: [] })
    .where(eq(comparisons.id, comparisonId));
}

/** Resolves a draft's pending names against Categories created since. */
export async function resolvePendingCategories(
  names: string[],
  db: Db = getDb(),
): Promise<CategoryRef[]> {
  if (!names.length) return [];
  const slugs = names.map(categorySlug);
  const lowered = names.map((name) => name.toLowerCase());
  const rows = await db
    .select({ slug: categories.slug, displayName: categories.displayName })
    .from(categories)
    .where(
      or(
        inArray(categories.slug, slugs),
        inArray(sql`lower(${categories.displayName})`, lowered),
      ),
    );
  const bySlug = new Map(rows.map((row) => [row.slug, row.displayName]));
  const byName = new Map(
    rows.map((row) => [row.displayName.toLowerCase(), row]),
  );
  return names.map((name) => {
    const slug = categorySlug(name);
    const bySlugName = bySlug.get(slug);
    if (bySlugName) return { slug, name: bySlugName };
    const match = byName.get(name.toLowerCase());
    return match
      ? { slug: match.slug, name: match.displayName }
      : { slug, name };
  });
}

export type ComparisonCategoryMap = Map<string, CategoryRef[]>;

/** Selected Categories per Comparison, in click order. */
export async function getComparisonCategories(
  comparisonIds: string[],
  db: Db = getDb(),
): Promise<ComparisonCategoryMap> {
  const map: ComparisonCategoryMap = new Map();
  if (!comparisonIds.length) return map;

  const rows = await db
    .select({
      comparisonId: comparisonCategories.comparisonId,
      slug: categories.slug,
      name: categories.displayName,
      position: comparisonCategories.position,
    })
    .from(comparisonCategories)
    .innerJoin(categories, eq(categories.id, comparisonCategories.categoryId))
    .where(inArray(comparisonCategories.comparisonId, comparisonIds))
    .orderBy(comparisonCategories.position);

  for (const row of rows) {
    const list = map.get(row.comparisonId) ?? [];
    list.push({ slug: row.slug, name: row.name });
    map.set(row.comparisonId, list);
  }
  return map;
}

const presetOrder = new Map<string, number>(
  PRESET_CATEGORIES.map((entry, index) => [entry.slug, index] as const),
);

/** Every Category with its published-Comparison count. */
export async function listCategories(db: Db = getDb()): Promise<CategoryOption[]> {
  const published = and(
    eq(comparisons.status, 'published'),
    isNull(comparisons.deletedAt),
    isNull(comparisons.takedownAt),
  );

  const rows = await db
    .select({
      slug: categories.slug,
      name: categories.displayName,
      featured: categories.featured,
      total: count(comparisons.id),
    })
    .from(categories)
    .leftJoin(
      comparisonCategories,
      eq(comparisonCategories.categoryId, categories.id),
    )
    .leftJoin(
      comparisons,
      and(eq(comparisons.id, comparisonCategories.comparisonId), published),
    )
    .groupBy(categories.id, categories.slug, categories.displayName, categories.featured);

  return rows
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      featured: row.featured,
      count: Number(row.total),
    }))
    .sort((left, right) => {
      const leftPreset = presetOrder.get(left.slug);
      const rightPreset = presetOrder.get(right.slug);
      if (leftPreset !== undefined || rightPreset !== undefined) {
        if (leftPreset === undefined) return 1;
        if (rightPreset === undefined) return -1;
        return leftPreset - rightPreset;
      }
      return right.count - left.count || left.name.localeCompare(right.name);
    });
}

/**
 * Installs or refreshes the curated presets. It never touches a community row:
 * adding a slug to the preset list is the deliberate promotion path (ADR 0012).
 */
export async function syncPresetCategories(db: Executor = getDb()): Promise<number> {
  for (const preset of PRESET_CATEGORIES) {
    await db
      .insert(categories)
      .values({
        id: uuidv7(),
        slug: preset.slug,
        displayName: preset.name,
        featured: true,
      })
      .onConflictDoUpdate({
        target: categories.slug,
        set: { displayName: preset.name, featured: true, updatedAt: new Date() },
      });
  }
  return PRESET_CATEGORIES.length;
}

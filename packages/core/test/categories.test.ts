import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  closeDb,
  closeRedis,
  createComparison,
  deleteCategory,
  getBoardFacets,
  getCardById,
  getComparisonForViewer,
  getDb,
  listCategories,
  publishComparison,
  renameCategory,
  resolveCategorySelection,
  unpublishComparison,
  updateComparison,
} from '../src/index';
import {
  categories,
  comparisonCategories,
  comparisons,
  models,
  responses,
} from '../src/db/schema';
import { categorySlug } from '../src/domain/categories';
import { createUserFixture, servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; Category tests skipped');
}

afterAll(async () => {
  await closeRedis();
  await closeDb();
});

const tag = () => uuidv7().replace(/-/g, '').slice(-10);

async function modelPair() {
  const db = getDb();
  const suffix = tag();
  return db
    .insert(models)
    .values([
      {
        id: uuidv7(),
        slug: `cat-base-${suffix}`,
        displayName: `Category Base ${suffix}`,
        monogram: 'CB',
        provider: 'mock',
      },
      {
        id: uuidv7(),
        slug: `cat-challenger-${suffix}`,
        displayName: `Category Challenger ${suffix}`,
        monogram: 'CC',
        provider: 'mock',
      },
    ])
    .returning();
}

async function newDraft(
  authorId: string,
  modelIds: { base: string; challenger: string },
  categoryNames: string[],
) {
  return createComparison({
    authorId,
    baseOutput: 'The base answer.',
    baseModelId: modelIds.base,
    prompt: 'Explain the difference between a queue and a stack.',
    modelIds: [modelIds.challenger],
    title: 'Queue versus stack',
    categories: categoryNames,
    effort: 1,
  });
}

async function publishNow(comparisonId: string, authorId: string) {
  const db = getDb();
  await db
    .update(comparisons)
    .set({ status: 'ready' })
    .where(eq(comparisons.id, comparisonId));
  await db
    .update(responses)
    .set({ status: 'done', contentMd: 'A challenger reply.' })
    .where(and(eq(responses.comparisonId, comparisonId), eq(responses.isBase, false)));
  return publishComparison(comparisonId, authorId);
}

async function removeCategory(slug: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  if (!row) return;
  await db.delete(categories).where(eq(categories.id, row.id));
}

describe.skipIf(!available)('community Categories', () => {
  it('creates a Category only when its Comparison is published', async () => {
    const author = await createUserFixture({ role: 'admin' });
    const [base, challenger] = await modelPair();
    const niche = `Niche ${tag()}`;
    const nicheSlug = categorySlug(niche);

    try {
      const draft = await newDraft(
        author.id,
        { base: base!.id, challenger: challenger!.id },
        ['Coding', niche],
      );

      const [beforePublish] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, nicheSlug));
      expect(beforePublish).toBeUndefined();

      const draftView = await getComparisonForViewer(draft.id, author.id);
      expect(draftView?.categories.map((entry) => entry.name)).toEqual(['Coding', niche]);

      const draftFacets = await getBoardFacets();
      expect(draftFacets.categories[nicheSlug] ?? 0).toBe(0);

      const card = await publishNow(draft.id, author.id);
      expect(card.categories.map((entry) => entry.slug)).toEqual(['coding', nicheSlug]);

      const [created] = await getDb()
        .select({ id: categories.id, featured: categories.featured, createdBy: categories.createdBy })
        .from(categories)
        .where(eq(categories.slug, nicheSlug));
      expect(created?.featured).toBe(false);
      expect(created?.createdBy).toBe(author.id);

      const joins = await getDb()
        .select({ position: comparisonCategories.position })
        .from(comparisonCategories)
        .where(eq(comparisonCategories.comparisonId, draft.id))
        .orderBy(comparisonCategories.position);
      expect(joins.map((row) => row.position)).toEqual([0, 1]);

      const facets = await getBoardFacets();
      expect(facets.categories[nicheSlug]).toBe(1);
      const library = await listCategories();
      expect(library.find((entry) => entry.slug === nicheSlug)?.count).toBe(1);
    } finally {
      await author.cleanup();
      await removeCategory(nicheSlug);
      await getDb().delete(models).where(inArray(models.id, [base!.id, challenger!.id]));
    }
  });

  it('leaves nothing behind when a draft is abandoned', async () => {
    const author = await createUserFixture();
    const [base, challenger] = await modelPair();
    const abandoned = `Abandoned ${tag()}`;
    const slug = categorySlug(abandoned);

    try {
      const draft = await newDraft(
        author.id,
        { base: base!.id, challenger: challenger!.id },
        [abandoned],
      );
      expect(draft.id).toBeTruthy();

      const library = await listCategories();
      expect(library.some((entry) => entry.slug === slug)).toBe(false);
      const [row] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, slug));
      expect(row).toBeUndefined();
    } finally {
      await author.cleanup();
      await getDb().delete(models).where(inArray(models.id, [base!.id, challenger!.id]));
    }
  });

  it('reuses a community Category by slug across Comparisons', async () => {
    const first = await createUserFixture();
    const second = await createUserFixture();
    const [base, challenger] = await modelPair();
    const shared = `Shared ${tag()}`;
    const slug = categorySlug(shared);

    try {
      const one = await newDraft(
        first.id,
        { base: base!.id, challenger: challenger!.id },
        [shared],
      );
      const two = await newDraft(
        second.id,
        { base: base!.id, challenger: challenger!.id },
        [shared.toUpperCase()],
      );

      await publishNow(one.id, first.id);
      await publishNow(two.id, second.id);

      const rows = await getDb()
        .select()
        .from(categories)
        .where(eq(categories.slug, slug));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.createdBy).toBe(first.id);
    } finally {
      await first.cleanup();
      await second.cleanup();
      await removeCategory(slug);
      await getDb().delete(models).where(inArray(models.id, [base!.id, challenger!.id]));
    }
  });

  it('enforces name, duplicate, new-Category and total caps', async () => {
    await expect(resolveCategorySelection(['a'])).rejects.toMatchObject({
      code: 'invalid_category_name',
    });
    await expect(resolveCategorySelection(['a'.repeat(25)])).rejects.toMatchObject({
      code: 'invalid_category_name',
    });
    await expect(
      resolveCategorySelection(['Front-end', 'Front end']),
    ).rejects.toMatchObject({ code: 'duplicate_category' });
    await expect(
      resolveCategorySelection([`One ${tag()}`, `Two ${tag()}`, `Three ${tag()}`, `Four ${tag()}`]),
    ).rejects.toMatchObject({ code: 'too_many_new_categories' });
    await expect(
      resolveCategorySelection([
        'Coding',
        'Reasoning',
        'Creative',
        'Math',
        'Long-context',
        'Language',
        'Agents',
      ]),
    ).rejects.toMatchObject({ code: 'too_many_categories' });
  });

  it('creates on edit only when the Comparison is already public', async () => {
    const author = await createUserFixture();
    const [base, challenger] = await modelPair();
    const draftOnly = `Draft edit ${tag()}`;
    const liveName = `Live edit ${tag()}`;
    const draftSlug = categorySlug(draftOnly);
    const liveSlug = categorySlug(liveName);

    try {
      const draft = await newDraft(
        author.id,
        { base: base!.id, challenger: challenger!.id },
        ['Coding'],
      );
      await expect(
        updateComparison(draft.id, author.id, {
          categories: [`A ${tag()}`, `B ${tag()}`, `C ${tag()}`, `D ${tag()}`],
        }),
      ).rejects.toMatchObject({ code: 'too_many_new_categories' });
      await expect(
        updateComparison(draft.id, author.id, {
          categories: [
            'Coding',
            'Reasoning',
            'Creative',
            'Math',
            'Long-context',
            'Language',
            'Agents',
          ],
        }),
      ).rejects.toMatchObject({ code: 'too_many_categories' });

      await updateComparison(draft.id, author.id, { categories: ['Coding', draftOnly] });
      const [pendingRow] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, draftSlug));
      expect(pendingRow).toBeUndefined();

      await publishNow(draft.id, author.id);
      await updateComparison(draft.id, author.id, {
        categories: ['Coding', liveName],
      });

      const [created] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, liveSlug));
      expect(created).toBeTruthy();

      const view = await getComparisonForViewer(draft.id, author.id);
      expect(view?.categories.map((entry) => entry.slug)).toEqual(['coding', liveSlug]);
    } finally {
      await author.cleanup();
      await removeCategory(draftSlug);
      await removeCategory(liveSlug);
      await getDb().delete(models).where(inArray(models.id, [base!.id, challenger!.id]));
    }
  });

  it('keeps a Category at count zero after its last Comparison is unpublished', async () => {
    const author = await createUserFixture();
    const [base, challenger] = await modelPair();
    const name = `Zero ${tag()}`;
    const slug = categorySlug(name);

    try {
      const draft = await newDraft(
        author.id,
        { base: base!.id, challenger: challenger!.id },
        [name],
      );
      await publishNow(draft.id, author.id);
      expect((await listCategories()).find((entry) => entry.slug === slug)?.count).toBe(1);

      await unpublishComparison(draft.id, author.id);
      const after = (await listCategories()).find((entry) => entry.slug === slug);
      expect(after).toBeDefined();
      expect(after?.count).toBe(0);
    } finally {
      await author.cleanup();
      await removeCategory(slug);
      await getDb().delete(models).where(inArray(models.id, [base!.id, challenger!.id]));
    }
  });

  it('keeps an unpublished Comparison’s Category edits pending until the next publish', async () => {
    const author = await createUserFixture();
    const [base, challenger] = await modelPair();
    const original = `Original ${tag()}`;
    const replacementName = `Replacement ${tag()}`;
    const originalSlug = categorySlug(original);
    const replacementSlug = categorySlug(replacementName);

    try {
      const draft = await newDraft(
        author.id,
        { base: base!.id, challenger: challenger!.id },
        [original],
      );
      await publishNow(draft.id, author.id);
      await unpublishComparison(draft.id, author.id);

      await updateComparison(draft.id, author.id, { categories: [replacementName] });
      const [pendingRow] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, replacementSlug));
      expect(pendingRow).toBeUndefined();
      const pendingView = await getComparisonForViewer(draft.id, author.id);
      expect(pendingView?.categories.map((entry) => entry.name)).toEqual([
        replacementName,
      ]);

      await publishComparison(draft.id, author.id);
      const [created] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, replacementSlug));
      expect(created).toBeTruthy();
      const publishedView = await getComparisonForViewer(draft.id, author.id);
      expect(publishedView?.categories).toEqual([
        { slug: replacementSlug, name: replacementName },
      ]);
      const oldJoins = await getDb()
        .select({ position: comparisonCategories.position })
        .from(comparisonCategories)
        .where(eq(comparisonCategories.comparisonId, draft.id));
      expect(oldJoins).toHaveLength(1);
    } finally {
      await author.cleanup();
      await removeCategory(originalSlug);
      await removeCategory(replacementSlug);
      await getDb().delete(models).where(inArray(models.id, [base!.id, challenger!.id]));
    }
  });

  it('protects presets from Admin rename and delete', async () => {
    const admin = await createUserFixture({ role: 'admin' });
    try {
      const [preset] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, 'coding'));
      expect(preset).toBeTruthy();
      await expect(renameCategory(admin.id, preset!.id, 'Code')).rejects.toMatchObject({
        code: 'preset_protected',
      });
      await expect(deleteCategory(admin.id, preset!.id)).rejects.toMatchObject({
        code: 'preset_protected',
      });
    } finally {
      await admin.cleanup();
    }
  });

  it('lets an Admin rename and delete a community Category', async () => {
    const admin = await createUserFixture({ role: 'admin' });
    const author = await createUserFixture();
    const [base, challenger] = await modelPair();
    const original = `Rename ${tag()}`;
    const renamed = `Renamed ${tag()}`;
    const originalSlug = categorySlug(original);
    const renamedSlug = categorySlug(renamed);

    try {
      const draft = await newDraft(
        author.id,
        { base: base!.id, challenger: challenger!.id },
        [original],
      );
      await publishNow(draft.id, author.id);
      const [row] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, originalSlug));
      expect(row).toBeTruthy();

      const updated = await renameCategory(admin.id, row!.id, renamed);
      expect(updated.displayName).toBe(renamed);
      // The slug is the stable identity; a rename relabels, it does not fork.
      expect(updated.slug).toBe(originalSlug);

      // Editing after the rename must keep the same row, matched by the
      // current display name rather than creating a new slug.
      await updateComparison(draft.id, author.id, { categories: [renamed] });
      const [stillThere] = await getDb()
        .select({ id: categories.id, slug: categories.slug })
        .from(categories)
        .where(eq(categories.id, row!.id));
      expect(stillThere?.slug).toBe(originalSlug);
      const [forked] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, renamedSlug));
      expect(forked).toBeUndefined();
      const afterEdit = await getComparisonForViewer(draft.id, author.id);
      expect(afterEdit?.categories).toEqual([{ slug: originalSlug, name: renamed }]);

      const pendingDraft = await newDraft(
        author.id,
        { base: base!.id, challenger: challenger!.id },
        [renamed],
      );

      await deleteCategory(admin.id, row!.id);
      const [pendingAfterDelete] = await getDb()
        .select({ pending: comparisons.pendingCategories })
        .from(comparisons)
        .where(eq(comparisons.id, pendingDraft.id));
      expect(pendingAfterDelete?.pending).toEqual([]);
      const [gone] = await getDb()
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, row!.id));
      expect(gone).toBeUndefined();
      const joins = await getDb()
        .select({ total: sql<number>`count(*)::int` })
        .from(comparisonCategories)
        .where(eq(comparisonCategories.comparisonId, draft.id));
      expect(joins[0]?.total).toBe(0);
    } finally {
      await author.cleanup();
      await removeCategory(originalSlug);
      await removeCategory(renamedSlug);
      await admin.cleanup();
      await getDb().delete(models).where(inArray(models.id, [base!.id, challenger!.id]));
    }
  });
});

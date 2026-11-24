# 02: Community categories

**What to build:** Categories stop being six constants. They become rows with stable slugs, so Authors can find community-created Categories in Step 3 or create their own when nothing fits, and the Board can list and filter them. Twelve presets are curated in code; Authors may create three new Categories per Comparison and select six in total; creation happens at publish, not while drafting. Admins can rename or delete community Categories, never presets.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Add `categories` (`slug`, `display_name`, `featured`, `created_by`, timestamps) and a `comparison_categories` join table; migrate existing `comparisons.categories text[]` values into join rows against the preset slugs and drop the column.
- [x] Preset list in code with stable slugs: Coding, Reasoning, Creative, Math, Long-context, Language + Agents, Tool use, Data analysis, Translation, Security, Roleplay; additive bootstrap sync that inserts and flags presets and never touches community rows.
- [x] Creation on publish only: a draft stores pending names; abandoning a draft creates nothing.
- [x] Validation: trim, collapse internal whitespace, 2–24 characters, casing preserved, collision on a case- and punctuation-insensitive slug, no duplicate within one Comparison; store the creator without displaying it.
- [x] Caps enforced server-side on create and edit: 3 new Categories and 6 selected per Comparison. Removing a NEW chip frees a creation slot.
- [x] Counts and facets cover published Comparisons only; a Category that loses its last Comparison stays at count 0.
- [x] Step 3 chips row: presets as toggles, extra selections as removable chips, NEW tag on categories created in this session, "N selected".
- [x] Category combobox: focus with empty query browses community Categories by count (user's own new first), typing searches presets and community with prefix ranking, exact match suppresses the create row; create row, empty results, 320px popover, keyboard and `aria-activedescendant` per the design.
- [x] Empty library state when no community Categories exist yet, rather than an empty "BROWSE COMMUNITY CATEGORIES" list.
- [x] Edit form uses the same combobox and the same caps; `comparisonPatchSchema` accepts any Category, not `z.enum(CATEGORIES)`.
- [x] Board sidebar: preset CATEGORIES list plus a COMMUNITY sub-list, single-select with presets, zero-count rows behind the existing-style ghost toggle; category filter by slug.
- [x] Board card and live preview show the first selected Category in click order.
- [x] Admin: rename and delete community Categories; presets reject both. Merge stays out.
- [x] Tests: slug collision, length and cap rules, publish-only creation, draft invisibility, legacy migration, facet counts excluding drafts, preset protection; e2e creating and reusing a Category and filtering the Board by it.

## Comments

- 2026-11-23 — Designed via `/grill-with-docs`. ADR 0012 records the entity decision; splitting "preset" from "featured" was rejected, so the chip row grows to twelve. Merge is deliberately a later ticket.
- 2026-11-24 — Implemented. `categories` + `comparison_categories(position)` replace `comparisons.categories`; migration `0008` creates the tables, inserts the twelve presets, backfills legacy `text[]` values by slug, and drops the column. A never-published Comparison stores its selection in `pending_categories`; publish materialises rows in one transaction, so an abandoned draft leaves nothing. Twelve presets live in `domain/categories.ts` and sync additively at bootstrap; community Categories are found or created by punctuation-insensitive slug, capped at 3 new / 6 selected per request, and counts cover published Comparisons only. Step 3 shows preset toggles, removable extra chips with a NEW tag and "N selected", and a combobox that browses community by count, searches presets and community with prefix ranking, suppresses Create on a slug match, and uses `aria-activedescendant` with a 320px popover. `/comparisons/:id/edit` reuses the same component and caps. The Board lists presets plus a COMMUNITY sub-list (zero-count rows behind a ghost toggle) and filters by `?category=<slug>`; cards show the first Category in click order. Admin gains a Categories table with rename/delete for community rows and a protected label for presets. Covered by `category-domain.test.ts` (slug/normalise/rank), `categories.test.ts` (publish-only creation, draft invisibility, reuse, caps, edit semantics, zero-count retention, preset protection, Admin rename/delete), `categories-migration.test.ts` (legacy backfill in a temporary database), the updated Board/filter tests, and `e2e/categories.spec.ts` (create → publish → edit → reuse → Board filter, plus Admin rename/delete).

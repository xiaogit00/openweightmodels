# 26: Make the Model pickers cover the full registry

**What to build:** The New Comparison form and the Add model menu offer every enabled Model in the curated registry, and stay easy to scan now the catalogue has 30 entries. A populated local database refreshes the registry on the next `pnpm db:init`, so a new release appears without a manual reseed.

**Blocked by:** None

**Status:** done

## Problem

- `getModels()` (`packages/core/src/queries.ts:840`) already returns every enabled Model, and `/new` renders all of them. There is no UI allow-list hiding newer Models.
- `initDatabase()` (`packages/core/src/db/init.ts:17`) skips the seed when users or Comparisons exist and never calls `syncModelRegistry()`. A populated local database therefore keeps the pre-ticket-18 demo rows forever. Only `pnpm db:bootstrap` and `pnpm db:seed` apply the catalogue.
- At 30 entries, Step 2 renders 30 tiles unconditionally and the Add model popover has no search field or `max-height`, so many entries are unreachable in practice.

## Acceptance criteria

- [ ] `pnpm db:init` on a populated database applies migrations, then syncs the Model registry. New entries are inserted, retired rows are disabled rather than deleted, an Admin-disabled Model stays disabled, and users/Comparisons are untouched.
- [ ] After init or bootstrap, `/new` can select all 30 enabled Models as the Base output model and as Challengers. Retired demo rows are gone from both pickers.
- [ ] The Base picker lists current releases first and visibly marks previous releases. A previous release remains findable by typing (native select type-ahead is fine).
- [ ] Step 2 shows current releases by default, grouped into **Open weights** and **Frontier API**. Previous releases sit behind a `Show previous releases (14)` disclosure rather than occupying the default view.
- [ ] Search in Step 2 searches all releases, including collapsed previous ones, and labels matching previous entries with a `Previous` badge. No model is unreachable.
- [ ] Selected Challengers are pinned in a `Selected` strip and remain visible and deselectable when filtered out or when previous releases are collapsed. The four-Challenger cap and Base-exclusion rules are unchanged.
- [ ] The Add model popover has a search field and a scrollable `max-height`; every eligible Model can be reached and selected. Base and existing Challengers stay excluded.
- [ ] Empty search and zero-model states are explicit.
- [ ] Keyboard users can reach search, filters, disclosure, and every model; Escape closes the popover and returns focus. The axe scan passes.
- [ ] 1440px, 768px and 360px layouts have no horizontal overflow. Visual baselines for `/new` and the comparison page are updated.
- [ ] Docs (`README.md`, `docs/ITERATING.md`, `docs/MODEL-REGISTRY.md`) state that `db:init` now syncs the registry and explain the picker's current/previous rule.

## Implementation notes

- Add `await syncModelRegistry()` to `initDatabase()` after `runMigrations()`, before the seed decision. The sync is already idempotent and preserves `enabled`.
- Do not add a schema migration for grouping metadata. Derive `family` and `release` from `MODEL_REGISTRY` by slug inside `getModels()`, and pass them through `/api/models`, `/new` and the comparison page. The registry remains the single source of truth.
- Put search/grouping/filtering rules in a client-safe pure helper under `packages/core/src/domain/` so the form, Add menu and tests share one behaviour.
- Recommended picker shape: search above a **Selected** strip; current releases grouped into **Open weights** and **Frontier API**; previous releases behind a disclosure. Search scans all releases and badges previous matches. The Base select gets four optgroups: Open weights · current, Open weights · previous, Frontier API · current, Frontier API · previous.
- Keep the existing visual language: 2px radii, surface fills, accent selection, monospace labels, monogram squares, Open/Frontier distinction.

## Coverage

- Core tests for the helper: search by name/slug, current/previous split, weight filter, matching a collapsed previous release, and selected-model pinning.
- E2E: select a new frontier Base model and a previous-release Challenger; use search and the previous disclosure; open Add model, search, and add a Model near the end of the list; confirm Base/existing models remain excluded.
- Accessibility and responsive checks on `/new` at the three widths above.

## Out of scope

- The Board's MODELS sidebar filter, which will also be long with 30 entries. A follow-up ticket can reuse the same search/collapse pattern.
- Registry curation and provider verification (ticket 18).

## Comments

- `initDatabase()` now runs `syncModelRegistry()` after migrations and before the
  seed decision, so `pnpm db:init` refreshes a populated database. Verified on a
  populated local database: 30 enabled Models, six retired demo rows disabled,
  users and Comparisons untouched.
- `getModels()` derives `family` and `release` from `MODEL_REGISTRY` by slug and
  passes them through `/api/models`, `/new` and the comparison page; no schema
  migration.
- New `packages/core/src/domain/model-picker.ts` owns search, current/previous
  splitting, weight filtering, disclosure and Selected pinning; the form, the
  Add model menu and the core tests share it.
- `/new` now has search, weight filters, a pinned Selected strip, Open
  weights/Frontier API groups and a previous-releases disclosure. The Base
  picker uses four current/previous optgroups and labels previous options
  `(previous)`. The Add model menu has search and a scrollable list.
- Coverage: 13 helper tests, a new `e2e/model-pickers.spec.ts` (including
  keyboard and popover Escape), expanded a11y and responsive assertions; the
  `/new` visual baseline is updated.

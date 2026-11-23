# 03: Board weight-class filter

**What to build:** The Board gains a **Weight class** filter that mirrors the Step 2 tabs — All, one entry per populated class, Frontier — so a reader can narrow to Comparisons that involve at least one Model of that size. Selecting a class combines with the existing category, model, effort and search filters, carries counts computed against the other active filters, and lives in the URL.

**Blocked by:** 01 — Weight-class catalogue and class browser.

**Status:** ready-for-agent

- [ ] Sidebar section immediately above MODELS: All · one row per populated class · Frontier, using the size glyph and class labels from Step 2.
- [ ] Semantics: selecting a class keeps Comparisons containing at least one enabled Model of that class, ANDed with every other active filter; mixed-class Comparisons count in each of their classes.
- [ ] Counts are facet-style: each class count reflects the other active filters, and the selected class does not narrow its own count to zero.
- [ ] Frontier shows Comparisons whose Models all lack a class (frontier or no longer in the registry); a Comparison whose Models have all left the catalogue appears in no class bucket.
- [ ] URL state `?class=<slug>`, round-tripping through reload and back/forward alongside `category`, `models`, `effort` and `q`, with one SSE stream preserved.
- [ ] Clearing via All, Clear filters or the filter chip restores the whole Board.
- [ ] Query: a class filter in `listComparisons` and the facets endpoint, joined through Model rows and their registry class; no N+1 per card.
- [ ] Selected state, hover and keyboard focus match the existing sidebar list buttons; the section is labelled and announced as a single-select group.
- [ ] Tests: SQL filter for a class and for Frontier, AND with other filters, facet counts, slug round-trip, mixed-class double count, comparison with only retired Models; e2e filtering the Board by class and returning to All.

## Comments

- 2026-11-23 — Designed via `/grill-with-docs`. Class is read from the registry at query time, so reclassifying a Model moves historical Comparisons between buckets — accepted as part of "the registry is the single source of truth". No class badges on Board cards in this change.

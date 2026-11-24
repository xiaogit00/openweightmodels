# Spec: weight classes and community categories

## Problem Statement

An author choosing a Challenger sees one undifferentiated list of open-weight Models plus a Frontier group. Nothing says how big a Model is or whether it could run on the author's own hardware, so "compare against something in my weight class" is impossible, and the site's premise (open weights you could host) is invisible at the moment of choice. At the same time the registry holds 20 open-weight Models, not the size-spread catalogue the design assumes.

Step 3 offers six fixed Categories. A comparison about agents, SQL, security or translation has to borrow the nearest preset, so the Board cannot express what people actually publish, and readers cannot browse those niches.

The two features meet in the catalogue: browsing by weight class needs a much broader, classed catalogue, and the curated CSV supplied with the design overlaps the registry by only 8 of 42 rows.

## Solution

Weight class becomes curated metadata on every open-weight Model, and Step 2 becomes a class browser: an **All sizes** tab plus one tab per populated class, with Frontier as its own tab, each Model card showing a memory bar against one global log scale. The catalogue is expanded to the design's curated list after verifying every provider ID, and the `current`/`previous` release slot is removed so every served Model stands as a peer in its class.

Categories become entities. The curated presets grow from six to twelve and are seeded from code; Authors can find community Categories in a combobox or create one when nothing fits, capped at three new and six total per Comparison. Community Categories appear in the Board sidebar and are filterable alongside presets. Admins can rename or delete community Categories; presets are protected.

The Board's model list is grouped by class instead of flat, each card carries a size glyph and says whether its comparison stays within one class, and the comparison page names each column's class and Run size.

## User Stories

1. As an author, I want to browse Challengers by weight class, so that I can compare Models of a similar size.
2. As an author, I want each Model to show how much memory it needs to run, so that I can tell whether it fits my hardware.
3. As an author, I want the memory bars to use one scale across classes, so that a Light bar and a Heavy bar are comparable.
4. As an author, I want to search by class name ("heavy"), so that I can jump to a class without hunting tabs.
5. As an author, I want my selection and search to survive switching tabs, so that browsing does not undo work.
6. As an author, I want the same four-Challenger limit across all tabs, so that the rule is predictable.
7. As an author, I want Frontier Models to remain first-class in their own tab, so that the comparison with closed models is not lost.
8. As an author, I want a Model's class and Run size visible on its card and tooltip, so that I understand what the bar measures.
9. As an author, I want a Front-end-style category I can create when no preset fits, so that a niche comparison is labelled honestly.
10. As an author, I want to find Categories other people created, sorted by how often they are used, so that I can reuse vocabulary instead of inventing near-duplicates.
11. As an author, I want creating a Category to be a single confirmed action inside the field I am already typing in, so that it does not feel like leaving the form.
12. As an author, I want a cap on how many Categories I create and select, so that the post stays precisely tagged.
13. As an author, I want a newly created Category tagged NEW until I submit, so that I can see what I added.
14. As an author, I want my draft's new Categories not to appear publicly until I publish, so that an abandoned draft leaves no trace.
15. As an author, I want removing a NEW chip to free a creation slot, so that the cap is not a trap.
16. As a reader, I want community Categories in the Board sidebar under the presets, so that I can browse niches.
17. As a reader, I want zero-count community Categories hidden behind a toggle, so that the sidebar stays short but nothing is lost.
18. As a reader, I want the Board's model list grouped by weight class, so that I can see the size spread of what people compare and select a whole class at once.
19. As a reader, I want a Board card to show its Models' classes and flag a comparison that crosses classes, so that I know whether the comparison spans hardware tiers.
20. As a reader, I want a comparison's columns to show each Model's class and Run size, so that I can tell what I am looking at without leaving the page.
21. As an admin, I want to rename or delete a community Category, so that typos and abuse do not live forever.
22. As an admin, I want presets protected from edits, so that deploys do not fight my changes.
23. As a keyboard user, I want the class tabs and the category combobox to work without a mouse, so that I can complete Step 2 and Step 3.
24. As a screen-reader user, I want the size conveyed in text, never by the glyph or bar alone, so that I can compare Models.
25. As a maintainer, I want the catalogue to reject a Model that cannot be replayed, so that Step 2 never offers a dead comparison.
26. As a maintainer, I want every open-weight entry to carry a class and Run size, so that no Model silently drops out of the browser.

## Implementation Decisions

**Weight class is Model metadata, not Comparison data.** A Comparison stores no class; it inherits each Model's class at read time from the registry. Reclassifying a Model therefore relabels historical Comparisons — deliberate, because the registry is the single source of truth. Frontier Models have `weightClass: null`; `null` is what puts them in the Frontier tab, and no client ever buckets a Run size into a class.

**Class and Run size are curated registry fields.** `ModelRegistryEntry` gains `weightClass`, `runSizeGb` (the CSV's `Combined_Min_GB`, upper bound where the source gives a range) and display parameter counts. Class and size never reach the database, following the existing `family`/`release` precedent: `modelRegistryRows()` strips them and `getModels()` re-attaches them by slug. A registry test requires both on every open-weight entry and rejects either on a frontier entry. `Previous_Weight_Class` stays in the CSV as a curation note and is not carried by the app.

**The catalogue has no release slots.** `release` is removed from the registry, `ModelRowWithRelease`, the pickers and the API; `family` remains metadata that search matches. Step 1's menu groups by class then Frontier, with no `(previous)` marker. The Step 2 previous-release toggle is removed for Frontier too. An entry is retired only when the vendor stops serving it. Monograms may repeat; only slugs and provider IDs stay unique. See ADR 0013.

**The catalogue expands behind a verification gate.** Every CSV Model is checked against OpenRouter's live model list before entry; a Model that cannot be replayed is not added, and classes whose population is empty simply get no tab. The twelve registry open-weight Models the CSV omits are hand-curated. Names are aligned to registry display names (`Qwen3.8-27B` → `Qwen3.8 27B`).

**Run size means memory to run at 4-bit.** It counts VRAM and system RAM, not parameters, and the UI always shows the GB value beside the bar. Bar fill is `(ln(gb) − ln 3) / (ln 2000 − ln 3)`, clamped, identical in every tab. The memory bar, six-bar size glyph, tab bar and combobox follow the design handoff at `design_handoff_weight_class/`.

**Categories are entities.** A `categories` table holds `slug`, `display_name`, `featured`, `created_by`, timestamps; a join table replaces `comparisons.categories text[]`. The migration backfills the presets and converts existing values, matched on display name. The Board filter and URL state use the slug. See ADR 0012.

**Twelve presets, curated in code.** The existing six plus Agents, Tool use, Data analysis, Translation, Security and Roleplay. The preset list lives beside the registry with stable slugs and syncs additively at bootstrap; presets are not renamable or deletable from Admin, and promoting a community Category later means adding its slug to that list. Admin rename/delete covers community Categories only. Merging near-duplicates is a later ticket, enabled by the identity model.

**Category lifecycle.** A Category is created when its Comparison is published; drafts hold pending names. Counts and Board facets include published Comparisons only. A Category that loses its last Comparison stays with count 0, hidden from Browse and the default sidebar list until used again. Input is trimmed, internal whitespace collapsed, 2–24 characters, casing preserved for display, and collision is judged on a punctuation- and case-insensitive slug, so "Front-end" and "Front end" cannot both exist. The creator is stored for moderation and never displayed. No profanity blocklist in v1. Each request may create at most 3 new Categories and select at most 6 total, enforced server-side.

**Category creation is available when editing too**, through the same combobox, under the same caps.

**Board sidebar groups Models by Weight class.** The MODELS section becomes ordered class groups (Fly → Super Heavy, then Frontier API), each with a tri-state select-all over the visible Models, a collapse control and a `{selected}/{visible}` count, following `design_handoff_weight_class_board/`. A group with no visible Models does not render. Grouping is presentational only: filter state and the URL stay selected Model slugs (`?models=`), and no `?class=` parameter returns. Collapsing keeps the selection and the cards filtered. Chips collapse into `"{Class} weight · {n} models"` when every Model with Comparisons in a class is selected and there is more than one such Model; the class chip represents every selected Model in the class, including ones with zero Comparisons, and removing it deselects them all. Groups start open at `lg` and above and collapsed below it.

**Frontier is presented, never stored as a class.** `Model.weightClass` stays `null` for Frontier models and no API emits a `frontier` class; presentation derives the group, label and ordering from `weightClassLabel(null)`, `modelClassTab()` and the `frontier` tab key. The UI may order and compare Frontier as a group without claiming it is a class.

**Board cards are side-by-side.** The Board card preview changes from stacked rows to side-by-side Base and Challenger columns, and the stacked layout is removed rather than kept as an unused variant. See ADR 0014.

**Class indicators are informational.** Glyphs, chips and matchup tags are not links and add no filter or navigation. The Board's weight-class filter stays dead.

**The matchup compares every Model on a card.** Same weight means every Model on the card shares a class. Otherwise the tag names the Base's class against the first Model whose class differs, and `+ {n} more` counts the Models beyond those two. Frontier Models appear as `API` in the tag.

**Class and Run size reach the UI through the registry join.** `CardModel`, the Board's models prop, the comparison page's Base model and response model, and the Add-a-model list all carry `weightClass` and `runSizeGb`, mapped server-side from the registry. No client buckets a Run size, and no page fetches `/api/models` to look one up.

**One presentation component.** `SizeGlyph` stays a pure bar renderer; a `WeightClassMark` handles the Frontier `cloud`, the short label and the composed `title`. The `mini` variant uses the handoff's 2/4/5/7/8/10px bars at 2px wide with a 1px gap. Step 2 keeps its own treatment: Frontier tabs and chips still carry no glyph.

**Keyboard and semantics.** The tab bar is `role="tablist"` with arrow-key navigation; glyphs are `aria-hidden` and every class name is present as text. The combobox uses `role="combobox"`/`listbox` with `aria-activedescendant`; options use `mousedown` + `preventDefault`; Esc clears then closes.

## Testing Decisions

- **Registry tests**: every open-weight entry has a class and Run size; frontier entries have neither; no `release` field remains; duplicate monograms allowed, duplicate slugs and provider IDs rejected; the shipped catalogue is verified and class coverage is reported.
- **Picker tests**: tab counts, section filtering, search matching class labels, selection and max-of-4 across tabs, previous-toggle removal, Frontier grouping, Base menu groups.
- **Category tests**: slug collision (case, spaces, hyphens), 2–24 characters, 3-new/6-total caps, presets protected from rename/delete, creation on publish only, counts exclude drafts, migration backfill of the six legacy values.
- **Board tests**: card payload carries `weightClass`/`runSizeGb`; zero-count community Categories behind the toggle; category/filter slug round-trip; the existing model, effort and search filters still AND correctly.
- **Presentation tests**: group order and hidden empty groups; select-all touching only visible Models; `{selected}/{visible}`; chip collapse including a selected zero-count Model; matchup copy and title for same-class, across-class, three-Model with a repeated class, and Frontier pairs; a `null` class renders the `cloud`, never a glyph.
- **e2e**: complete a comparison browsing by class and creating a Category; select a sidebar class, collapse it, see the class chip and remove it; a Board card shows the glyph and matchup tag; the comparison chip follows a response switch and an added Model; admin renames and deletes a community Category.

## Out of Scope

- Merging near-duplicate Categories (ticket follows, now possible).
- Promoting a community Category to preset from the UI.
- A Board weight-class filter (reversed 2026-11-24 — the grouped MODELS list replaces it).
- Making a class glyph, chip or matchup tag clickable, or a navigation entry point.
- A reader toggle between side-by-side and stacked Board cards.
- Author-side rename/delete of Categories.
- A profanity blocklist.
- Category translation.
- Restoring open-weight previous releases as a hidden tier.

## Further Notes

- Source design: `design_handoff_weight_class/` (README, designs, CSV), with the Board and comparison deltas in `design_handoff_weight_class_board/`. Deviations from them: no release slots (ADR 0013), twelve presets instead of six, Board cards are side-by-side (ADR 0014), the matchup compares every Model on a card rather than the Base and first Challenger, and the sidebar groups also exist below `lg` with groups collapsed by default.
- Ticket 03 (Board weight-class filter) was discarded on 2026-11-24 after its implementation was reverted; the grouped MODELS list replaces it, and its stories and decisions are gone from this spec. Do not resurrect `?class=` on the Board — Step 2 alone owns that parameter.
- `GLOSSARY.md`, `docs/MODEL-REGISTRY.md`, ADR 0012, ADR 0013 and ADR 0014 are already updated to this model.
- Stale docs to correct during implementation: `docs/ITERATING.md` (pickers), `docs/IMPLEMENTATION-STATUS.md` (registry rule).
- The OpenRouter verification of the 42 CSV rows is the first task of ticket 01; its result decides which tabs exist at launch.

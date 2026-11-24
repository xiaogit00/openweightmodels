# 03: Weight-class presentation and data plumbing

**What to build:** One way to render a Model's class and Run size, and the metadata every surface needs to do it. A `WeightClassMark` sits over the existing `SizeGlyph` so a Frontier Model (`weightClass: null`) draws a cloud instead of bars, and every payload the Board and comparison page render carries `weightClass` and `runSizeGb` from the registry join. No new surface yet — this ticket exists so 04, 05 and 06 do not each invent their own lookup, formatter or tooltip.

**Blocked by:** None. 01 and 02 are done.

**Status:** done

- [x] `SizeGlyph`'s `mini` variant uses the handoff's exact geometry: six 2px bars at 2/4/5/7/8/10px, 1px gap, 10px box, `align-items:flex-end`. The `tab` variant is unchanged.
- [x] Add `WeightClassMark` beside `SizeGlyph` in `apps/web/src/components/ui/`: accepts `weightClass: WeightClassKey | null`, optional `runSizeGb`, renders the mini glyph or a 12px Phosphor `cloud` for Frontier, and exposes the short label (`Light`, `Frontier API`) for callers that print text.
- [x] `WeightClassMark` composes the native `title`: `"{Class} weight · {gb} to run at 4-bit"`; without a GB `"{Class} weight · {range}"`; Frontier `"Frontier API · hosted only · size undisclosed"`. The glyph/icon is `aria-hidden`; where no visible label is rendered, an `aria-label` carries the class.
- [x] `cardFromRows` attaches `weightClass` and `runSizeGb` to every `CardModel` through the existing registry metadata (`attachModelMetadata` / `MODEL_METADATA_BY_SLUG`); update the `ComparisonCard` type. SSE-published cards use the same projection, so nothing else needs patching.
- [x] The Board page's `models` prop and `BoardModel` gain `weightClass` and `runSizeGb`.
- [x] The comparison page's `baseModel`, the response view used by the challenger header, and `AddableModel` carry `weightClass` and `runSizeGb`, mapped server-side from the registry. No page fetches `/api/models` to look one up.
- [x] No API or stored value emits a `frontier` class: ordering and grouping derive from `WEIGHT_CLASSES` and `modelClassTab()`.
- [x] Step 2 is untouched: Frontier tabs and chips still carry no glyph.
- [x] Tests: the card projection carries class and size for every Model, including extra challengers; the mark renders a cloud and the Frontier title for `null`, a GB title, and a range fallback; `/api/models` shape and the registry invariants are unchanged.

## Comments

- 2026-11-24 — Designed via `/grill-with-docs` against `design_handoff_weight_class_board/`. Decisions: Frontier stays `null` in data and is presented by a shared helper, never a sentinel class; class and size come to the UI through the registry join rather than a client lookup; one `WeightClassMark` wraps a pure `SizeGlyph`; the handoff's mini geometry replaces the 0.75× approximation. Ticket 03 (Board weight-class filter) was discarded the same day; this file reuses the number.

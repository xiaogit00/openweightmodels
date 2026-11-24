# 05: Board cards — side-by-side, size glyph and matchup line

**What to build:** The Board card previews Base and Challenger in two columns (replacing the stacked rows), each Model's name is followed by its mini class mark, and a new line under the prompt says whether the comparison stays in one weight class or crosses classes.

**Blocked by:** 03 — Weight-class presentation and data plumbing.

**Status:** done

- [x] Replace the stacked `ModelPreviewRow` layout in `apps/web/src/components/comparison-card.tsx` with the handoff's side-by-side Base/Challenger columns. Keep the rest of the card: categories, effort, turn count, author, comment/annotation counts, hover, focus, link behaviour and arrival animation. Delete the stacked markup rather than keeping it as an unused variant. See ADR 0014.
- [x] Keep side-by-side at every card width, including the Board grid's 320px minimum; there is no stacked fallback.
- [x] Place the mini `WeightClassMark` directly after each Model's name (inside the existing 6–8px gap row, before `+N more` on the Challenger) in a `flex-shrink:0` span coloured `neutral-400`, so the Frontier cloud matches. Name truncation and the mark never shrinking both hold.
- [x] Give the mark a `title` and `aria-label` of `"{Class} weight · {GB} to run at 4-bit"`; without a GB use `"{Class} weight · {range}"`; Frontier reads `"Frontier API"`.
- [x] Add the matchup line directly below the prompt title, pulled up against the card's column gap. It is one inline-flex tag: `max-width:100%`, 24px tall, 6px gap, radius `--r`, 12.5px, nowrap, `overflow:hidden`; the label span has `min-width:0`, `padding-right:1px` and `text-overflow:ellipsis`. Full text always in the `title`.
- [x] Same weight: `ph ph-equals` at 13px, no padding, transparent background and border, `accent-300` at 400 weight, copy `"Same weight · {Class}"`, title `"Same weight class: both models are {Class} weight"`.
- [x] Across weight classes: `ph-fill ph-lightning` at 13px, padding `0 9px 0 8px`, background `--color-accent-900`, 1px `--color-accent-700` border, `accent-200` at 500 weight, copy `"Across weight class · {Base class} vs {First different class}"` plus `" + {n} more"` when Models beyond the two named exist. Frontier reads `API`, e.g. `"Across weight class · Light vs API"`. The title names the classes and the extra count.
- [x] Compare **every** Model on the card: same weight only when all of them share a class; otherwise name the Base's class against the first Model whose class differs, with `{n}` counting Models beyond that pair. Two Frontier Models count as the same group and read `"Same weight · API"`.
- [x] Copy is short-label based (`Light`, `Super Heavy`, `API`), never a full `"{Class} weight"` inside the pair. At 320px, short tags render without an ellipsis and longer ones truncate cleanly on one line.
- [x] The tag does not rely on colour: the icon and the wording differ too.
- [x] Tests: extract the matchup copy and title composition into pure helpers and unit-test same-class, across-class, three Models where a later Challenger is the mismatch, more than two classes, a Frontier pair, and Frontier vs open-weight; e2e asserts a card's `data-size-glyph` or Frontier cloud plus the tag copy in both themes; regenerate the Board visual snapshots.

## Comments

- 2026-11-24 — Designed via `/grill-with-docs` against `design_handoff_weight_class_board/`. Decisions: adopt side-by-side as the default and drop the stacked layout (reverses `design_handoff_redesign`; ADR 0014); the matchup compares every Model on the card rather than the handoff's Base + first Challenger, so a hidden mismatch cannot read as "Same weight"; Frontier pairs show the quiet tag with `API`. Glyph is decorative and the tag carries text, so neither relies on colour alone.

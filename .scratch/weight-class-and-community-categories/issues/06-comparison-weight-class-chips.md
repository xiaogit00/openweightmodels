# 06: Comparison page — class chips and menu labels

**What to build:** Both column headers on a Comparison show each Model's weight class and Run size as a chip, and the response switcher and Add-a-model menus show the class label on every row. The challenger chip follows the active response.

**Blocked by:** 03 — Weight-class presentation and data plumbing.

**Status:** ready-for-agent

- [ ] Base column header in `apps/web/src/components/comparison/comparison-responses.tsx`: add the chip after the Model name, before the spacer and token meta.
- [ ] Challenger header in `apps/web/src/components/comparison/model-picker.tsx`: add the chip after the switcher button and before the `{n} responses` label.
- [ ] Chip: inline-flex, `flex-shrink:0`, 22px tall, padding `0 8px`, 6px gap, 1px `neutral-700` border, radius `--r`, 12px `neutral-300`, nowrap. Contents: the `WeightClassMark` mini glyph or Frontier cloud, the short label (`Middle`, or `Frontier API`), then the GB in Space Mono 11px `neutral-400` when known. Use the mark's composed `title` (`"Middle weight · 64 GB to run at 4-bit"`, `"Super Heavy weight · 300 GB+"`, `"Frontier API · hosted only · size undisclosed"`).
- [ ] The challenger chip follows the active response: it updates on switch, after an added Model becomes active, and while a response is generating.
- [ ] Widen the switcher / Add-a-model popover from 290px to 340px. Add a trailing class label on every row: after the name and before the spinner or check on the Responses rows, and before the ETA on the Add-a-model rows. Inline-flex, 6px gap, the mark plus short label at 11.5px/400 `neutral-400`, nowrap, same `title`.
- [ ] Frontier rows and chips read `Frontier API` and never show a GB.
- [ ] Leave the per-turn cells and the mobile `BASE` badge unchanged — the header is sticky, so repeating the chip on every Turn only adds noise.
- [ ] No overflow: the switcher still truncates the Model name rather than the chip, the header fits at its narrowest width, and menu rows do not wrap at 340px. If the chip cannot fit beside the switcher on a narrow header, hide it at the same breakpoint as the `{n} responses` label instead of shrinking it.
- [ ] Check `accent`/`neutral` contrast for the chip and label text in both themes, and keep the class available as text, not only as the glyph.
- [ ] Tests: e2e asserts the chip on both headers, switching the active response updates the challenger chip, adding a Model updates it, and both menu sections show labels; cover the copy helpers from 03 with unit tests; both themes.

## Comments

- 2026-11-24 — Designed via `/grill-with-docs` against `design_handoff_weight_class_board/`. Decisions: indicators are informational, not links or filters; chips live on the two column headers only, not in per-turn cells; Frontier shows `Frontier API` with no Run size. Requires `runSizeGb` on the comparison payloads from ticket 03.

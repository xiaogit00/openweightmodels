# 04: Board sidebar grouped by weight class

**What to build:** The Board's flat MODELS list becomes ordered class groups — Fly → Super Heavy, then Frontier API — each with a tri-state select-all over its visible Models, a collapse control, a `{selected}/{visible}` count and a mini class mark. Chips collapse to one class chip when a whole class is selected. Grouping is presentation only: the URL keeps `?models=`, and the discarded `?class=` filter does not return.

**Blocked by:** 03 — Weight-class presentation and data plumbing.

**Status:** done

- [x] Replace the flat MODELS list in `apps/web/src/components/board-client.tsx` with class groups in `WEIGHT_CLASSES` order, then Frontier API, in an 8px-gap column. Each group is `role="group"` with `aria-label="{Class} weight"`, and a group with no visible Models never renders.
- [x] Group header row (2px gap, two buttons): a select-all button (`flex:1`, 30px, padding `0 10px`, 10px gap, radius `--r`, transparent, hover `--color-surface`) that is `role="checkbox"` with `aria-checked="true|mixed|false"`, `aria-label="Select all {Class} weight models"` and a native `title` of `"{Class} weight · {range} · {hint}"` (Frontier: `"Frontier API · hosted only · size undisclosed"`). Contents: a 15×15 checkbox (neutral-600 border when empty; accent fill with an `on-accent` 11px `minus` when partial or `check` when all), the mini mark, the 10.5px/500 uppercase 0.08em `neutral-300` label, the range in 11.5px `neutral-500` (`flex:1`, ellipsis; Frontier shows `API`), and the 11.5px `accent-300` `{selected}/{visible}` count only while partial.
- [x] Collapse button: 26×30, transparent, `neutral-400`, hover surface, `aria-expanded`, `aria-label="Toggle {Class} weight"`, 12px `caret-up` when open and `caret-down` when collapsed.
- [x] Group rows are indented 17px behind a `1px neutral-800` left border, using the existing model list button with padding `4px 10px 4px 12px`, its 15px checkbox, ellipsised name and 12px `neutral-400` count. Hover, focus and pressed states stay as they are.
- [x] Select-all toggles **visible** Models only: with "Show fewer" active it never touches hidden zero-count Models, and it deselects the visible set when every visible Model is already selected. Clicking a row still toggles one Model.
- [x] Collapsing hides rows but keeps the selection and the Board's filtering; expanded/collapsed state is local (session-only), open at `lg` and above, collapsed below `lg`.
- [x] `{selected}/{visible}` counts visible Models only, so it can never read `4/3`; hidden selections still filter cards and are reflected by the checkbox state.
- [x] Chips: when every Model with Comparisons in a class is selected and more than one exists, collapse them into `"{Class} weight · {n} models"`. The class chip represents every selected Model in the class, including zero-count ones; removing it clears them all. Otherwise each Model keeps its chip. Chips are `white-space:nowrap; flex-shrink:0`.
- [x] URL and filter semantics are unchanged: chips add/remove individual slugs in `?models=`, no `?class=` is introduced, and facet counts, SSE patching, `matchesFilters`, Clear and the "All N models / Show fewer" toggle behave as before.
- [x] Below `lg` the header and rows span both columns of the filter grid, and every group starts collapsed so the Board stays reachable.
- [x] Keyboard: the header is a real tri-state checkbox in the tab order, the collapse button is reachable and announces `aria-expanded`, and collapsed rows leave the tab order.
- [x] Tests: extract the grouping, visible-count, collapse predicate and chip-building logic into pure helpers with unit tests — class order, hidden empty groups, visible-scoped counts, a selected zero-count Model collapsing into the class chip, and removing it clearing every slug; e2e selecting a group (none → all), unchecking one row (mixed, `2/3`), collapsing with the selection kept, the class chip appearing and clearing; both themes.

## Comments

- 2026-11-24 — Designed via `/grill-with-docs` against `design_handoff_weight_class_board/`. Decisions: full design fidelity (groups, select-all, collapse, chip collapsing); the class chip covers selected zero-count Models too; counts are visible-scoped; groups start collapsed below `lg`; no `?class=` filter returns. The old `03-board-weight-class-filter.md` was discarded, not superseded.

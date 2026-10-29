# 03: Redesign the Board

**What to build:** The redesigned Board: live ticker, filter sidebar, title/count/sort row, active-filter chips, comparison-card grid, pagination, and all empty/loading/error/signed-out states. Keep discovery behaviour identical except the intentional model-list default.

**Blocked by:** 02.

**Status:** done.

**Design source:** `design_handoff_redesign/designs/Board.dc.html` and the "Screen 1 — Board" section of `design_handoff_redesign/README.md`. Keep the stacked response preview; do not build the side-by-side variant.

- [x] Page: `clamp(200px, 22vw, 248px) | minmax(0, 1fr)` grid, max-width 1440px, centered. Sidebar sticky at `top: 91px`, `max-height: calc(100vh - 91px)`, thin scrollbar, 36px 16px 40px 24px padding. Main 36px 32px 72px, 24px vertical gap.
- [x] Ticker: 38px, 24px side padding, bottom border, `LIVE` label with 6px pulsing accent dot, scrolling events with icons and edge masks, duplicated list, reduced-motion safe, `data-ticker` preserved.
- [x] Sidebar **CATEGORIES**: 34px rows, counts, single-select, active `neutral-800` + `accent-300` count, hover surface, `aria-pressed`.
- [x] Sidebar **MODELS**: 32px rows, 15px checkbox, counts, clear link when any selected. By default list only models with at least one comparison; a ghost **Show all N models / Show fewer** toggle reveals the rest. A selected model is always visible even when its count is zero. Multi-select, `aria-pressed`.
- [x] Sidebar **EFFORT**: three 32px outlined toggles (Low / Med / High), multi-select (rendered as three independent toggles; the URL/API carry one effort, so at most one is pressed), active `accent-900` / `accent-600` border / `accent-200` text.
- [x] Title row: H1 "Board" at 30px; count line at 13px with `aria-live="polite"` reading `N comparisons` or `N of M comparisons` when filtered. The count is the total matching count, not the number loaded.
- [x] Sort segmented **Live / Top / New** with lightning / fire / clock icons, using the shared primitive. Keep the real API ordering for Top.
- [x] Active-filter chip row appears only when a filter is set: one removable 26px outlined chip per search query (quoted), category, model and effort; then **Clear all**. Removing a chip updates the same URL-backed state.
- [x] Card: `--color-surface`, 1px `neutral-800`, `--r-lg`, 20px 20px 18px, 18px gap, whole card is a link. Hover `neutral-700` border + `neutral-900` background. Meta row (category chip, effort glyph + label, turn count), title 17px / 1.35 clamped to two lines, Base row with accent-800 badge + **BASE** tag, Challenger row with neutral-700 badge + `+N more`, each with a two-line 13.5px preview, footer with author initials/handle/relative time and discussion/annotation counts. Keep `data-card-turn-count`, `data-card-comment-count`, `data-card-annotation-count`.
- [x] Grid `repeat(auto-fill, minmax(min(320px, 100%), 1fr))`, 16px gap.
- [x] **Pagination.** Keep 48-per-page cursor pagination. Replace the current load control with an outlined **Load more** button under the grid, keep `data-testid="board-sentinel"` for automatic loading, and preserve the existing debounce/cursor guards. No duplicate fetches while a filter is changing.
- [x] **States.** Loading, error (`role="alert"` with current retry), empty (dashed `neutral-700`, "No comparisons match", hint, **Clear filters**) and signed-out (header CTA + **Sign in**) all work in both themes.
- [x] **Search.** Matches prompt text and model names; `/` focuses, Esc clears and blurs; placeholder and `aria-label="Search comparisons"` unchanged. Filter state stays URL-backed.
- [x] Preserve the current responsive behaviour at 768px and 360px, restyled: no horizontal overflow, sidebar controls reachable, ticker does not trap focus.
- [x] Update `e2e/visual.spec.ts` Board metrics at 1440: header 53px, ticker 38px, sidebar 248px, main padding-left 32px, card gap 16px, max-width 1440px. Baselines are refreshed centrally by the orchestrator.
- [x] `pnpm typecheck` and `pnpm --filter @owm/web test` pass; the browser suite runs centrally.

**Key files:** `apps/web/src/app/page.tsx`, `apps/web/src/components/board-client.tsx`, `comparison-card.tsx`, `avatar.tsx`, `e2e/visual.spec.ts`, `e2e/board.spec.ts`, `e2e/responsive.spec.ts`.

**Implementation notes:** The design's sample count ("16 comparisons") is placeholder data. Keep the API's real total and cursor. Do not remove the sentinel in favour of click-only loading; keyboard and screen-reader users rely on it. The model-list default is the only intentional behaviour change.

**Out of scope:** A side-by-side card preview, new ranking logic, changing page size.

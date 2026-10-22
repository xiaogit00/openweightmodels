# 06: Paginate and stabilise the Board

**What to build:** The Board remains stable and fast as the number of published Comparisons grows. It pages with an opaque cursor, appends pages through infinite scroll with a Load more fallback, computes sidebar counts globally, keeps one SSE connection regardless of sort changes, queues arrivals when the reader is scrolled away, and preserves filters in the URL.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish.

**Status:** done

- [x] The list API returns 48 items per page with a correct `total` and an opaque cursor; the UI appends pages without duplicates.
- [x] Infinite scroll uses a sentinel and also offers an accessible Load more button when it does not fire.
- [x] Sidebar Category and Model counts are global, not counts of the currently loaded page.
- [x] The Board keeps one SSE subscription across sort and filter changes; reconnecting resumes from the last event.
- [x] New published Comparisons animate in at the top when the reader is near the top, and queue into the existing pill when scrolled further than 200px.
- [x] Top-sorted counts update in place without reordering cards; a refetch applies the new order.
- [x] Relative times refresh every minute.
- [x] Category, Model, Effort, Sort and Search state survive reload and browser back/forward through the URL.
- [x] Empty, loading, error and reduced-motion states are explicit.

## Comments

- 2026-10-22 — Implemented. `listComparisons` keeps the keyset cursor (48 default, sort-aware, now rejecting a Top cursor without a score) and a new `GET /api/comparisons/facets` supplies global Category/Model counts plus the published total. `BoardClient` now owns server-paginated state: URL-backed filters via `pushState`/`popstate`, page-one refetch on filter or sort changes, an `IntersectionObserver` sentinel and an always-available Load more button, deduplicating pages through `appendUniqueCards`.
- A single SSE effect (no `sort` dependency) connects with `?after=<newest snapshot id>` so the replay never duplicates the server-rendered ticker, and the browser's `Last-Event-ID` handles reconnects. Publish events patch global facets. Matching Live and New arrivals insert at the top within 200px; scrolled readers and every Top arrival queue into the pill. Flushing Top refetches page one so the server applies the new ranking, and re-clicking the active sort tab forces the same refetch after counts changed in place. Annotation/comment events bump counts without reordering.
- Sidebar counts, relative-time minute ticks, explicit loading/error/Retry/empty states and a `prefers-reduced-motion` path are covered by `packages/core/test/filters.test.ts`, `board.test.ts`, `cursor.test.ts` and `e2e/board.spec.ts`. `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` and `pnpm --filter @owm/web build` pass.

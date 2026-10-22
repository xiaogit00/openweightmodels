# 06: Paginate and stabilise the Board

**What to build:** The Board remains stable and fast as the number of published Comparisons grows. It pages with an opaque cursor, appends pages through infinite scroll with a Load more fallback, computes sidebar counts globally, keeps one SSE connection regardless of sort changes, queues arrivals when the reader is scrolled away, and preserves filters in the URL.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish.

**Status:** ready-for-agent

- [ ] The list API returns 48 items per page with a correct `total` and an opaque cursor; the UI appends pages without duplicates.
- [ ] Infinite scroll uses a sentinel and also offers an accessible Load more button when it does not fire.
- [ ] Sidebar Category and Model counts are global, not counts of the currently loaded page.
- [ ] The Board keeps one SSE subscription across sort and filter changes; reconnecting resumes from the last event.
- [ ] New published Comparisons animate in at the top when the reader is near the top, and queue into the existing pill when scrolled further than 200px.
- [ ] Top-sorted counts update in place without reordering cards; a refetch applies the new order.
- [ ] Relative times refresh every minute.
- [ ] Category, Model, Effort, Sort and Search state survive reload and browser back/forward through the URL.
- [ ] Empty, loading, error and reduced-motion states are explicit.

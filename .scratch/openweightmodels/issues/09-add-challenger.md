# 09: Add a Challenger to a published Comparison

**What to build:** The Author can add one more Challenger to a published Comparison from the comparison page. The pending Response is visible only to the Author while it generates, then becomes public atomically on completion. A failed add is author-only and offers Retry or Dismiss. The four-Challenger cap and duplicate rules are enforced.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish; 07 — Sign in with email magic links.

**Status:** done

- [x] The “Add model” menu lists enabled Models not already in the Comparison, excludes the Base model, and shows ETAs.
- [x] Adding is disabled at four Challengers; duplicate Models and the Base model are rejected with clear feedback.
- [x] A pending tab with spinner and “Calling {model} hosted API…” is visible only to the Author.
- [x] The public sees the tab only after the Response is Done; publishing is atomic and updates the card preview and counts.
- [x] A failed add shows an author-only error tab with Retry and Dismiss; the public never sees it.
- [x] Adding does not alter the Prompt, Base output or existing Responses.
- [x] Live status updates work through the existing SSE/Job mechanism and survive a reload.
- [x] Only the Author can add a Challenger; everyone else gets 404/403.

## Comments

- 2026-10-22 — Implemented. The published Comparison page has a Radix Add model popover (enabled models only, Base/existing excluded, ETAs shown, disabled with a visible “4 of 4” at the cap). A pending add renders an author-only tab with spinner, “Calling … hosted API…” copy and a shimmer pane, subscribes to that Job's existing `/api/stream/jobs/:id` channel, and resyncs from the author-only `GET /comparisons/:id/responses` when it settles. Failed adds get an author-only retry/dismiss pane. `getComparisonForViewer` now omits pending, failed and skipped challenger Responses for non-authors, and `finalizeJob` emits the settled card on `run.finished` so a live Board card replaces its model list, snippets and counts atomically. A skipped failed add releases its Challenger slot while the model stays used. Covered by `packages/core/test/add-challenger.test.ts` (frozen Prompt/Base/existing Responses, public/author visibility, atomic publication, Retry, Dismiss, cap/duplicate/Base/disabled rules, dismissed-slot release), author-only permission tests, and `e2e/add-challenger.spec.ts` (menu contents and ETA, author-only tab until completion, no Add control for readers).

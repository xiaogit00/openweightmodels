# 09: Add a Challenger to a published Comparison

**What to build:** The Author can add one more Challenger to a published Comparison from the comparison page. The pending Response is visible only to the Author while it generates, then becomes public atomically on completion. A failed add is author-only and offers Retry or Dismiss. The four-Challenger cap and duplicate rules are enforced.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish; 07 — Sign in with email magic links.

**Status:** ready-for-agent

- [ ] The “Add model” menu lists enabled Models not already in the Comparison, excludes the Base model, and shows ETAs.
- [ ] Adding is disabled at four Challengers; duplicate Models and the Base model are rejected with clear feedback.
- [ ] A pending tab with spinner and “Calling {model} hosted API…” is visible only to the Author.
- [ ] The public sees the tab only after the Response is Done; publishing is atomic and updates the card preview and counts.
- [ ] A failed add shows an author-only error tab with Retry and Dismiss; the public never sees it.
- [ ] Adding does not alter the Prompt, Base output or existing Responses.
- [ ] Live status updates work through the existing SSE/Job mechanism and survive a reload.
- [ ] Only the Author can add a Challenger; everyone else gets 404/403.

# 08: Job-ready notifications

**What to build:** The notification bell becomes real. When a Job finishes, its Author receives exactly one in-app notification that links back to the Job or Comparison. The bell shows unread state and a dropdown, and notifications can be marked read individually or all at once.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish; 07 — Sign in with email magic links.

**Status:** done

- [x] A signed-in user sees a bell with an unread indicator when notifications exist.
- [x] A Job that settles creates exactly one `job.ready` notification for its Author, with no duplicates on retry or concurrent completion.
- [x] The dropdown lists newest first and links each notification to the Job or Comparison.
- [x] Individual and mark-all-read actions persist across reload.
- [x] Other users cannot see another Author's notifications; anonymous visitors see no bell state that implies an account.
- [x] An empty state is shown when there are no notifications.
- [x] Notifications survive a reload and do not leak draft titles to non-authors.

## Comments

- 2026-10-22 — Implemented. The header bell renders for signed-in users only, shows the unread count and opens a newest-first popover; opening an item marks it read and links to the published Comparison or to the Job while it is still a draft, and "Mark all read" clears the rest. Empty, loading and retryable error states are included. `GET /api/notifications` now resolves the caller's Comparison at read time to show its title — rows store IDs only, so a draft title is never copied into a notification — and `PATCH` accepts exactly `{ id }` or `{ all: true }`. `markNotificationsRead` takes an explicit target so an accidental undefined id can no longer mark everything read, and repeat marks no longer overwrite the original `read_at`. Covered by `packages/core/test/notifications.test.ts` (owner scoping, newest-first order, single/all read persistence, concurrent finalisation dedupe), `apps/web/test/notifications.test.ts` (link and label rules), and the Playwright journey (unread → read across reload, second reader sees an empty bell, anonymous header has no bell).

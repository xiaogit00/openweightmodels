# 08: Job-ready notifications

**What to build:** The notification bell becomes real. When a Job finishes, its Author receives exactly one in-app notification that links back to the Job or Comparison. The bell shows unread state and a dropdown, and notifications can be marked read individually or all at once.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish; 07 — Sign in with email magic links.

**Status:** ready-for-agent

- [ ] A signed-in user sees a bell with an unread indicator when notifications exist.
- [ ] A Job that settles creates exactly one `job.ready` notification for its Author, with no duplicates on retry or concurrent completion.
- [ ] The dropdown lists newest first and links each notification to the Job or Comparison.
- [ ] Individual and mark-all-read actions persist across reload.
- [ ] Other users cannot see another Author's notifications; anonymous visitors see no bell state that implies an account.
- [ ] An empty state is shown when there are no notifications.
- [ ] Notifications survive a reload and do not leak draft titles to non-authors.

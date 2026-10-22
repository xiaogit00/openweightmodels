# 14: Report, suspend and remove harmful content

**What to build:** Signed-in users can report a Comparison, Discussion comment or Annotation. Admins get a report queue where they can review, hide or restore content, suspend a user and see an audit trail. Suspended users cannot write, and their existing content follows the chosen moderation policy.

**Blocked by:** 07 — Sign in with email magic links; 10 — Edit and delete your Discussion and Annotations; 11 — Minimal admin for Models and takedowns.

**Status:** ready-for-agent

- [ ] A signed-in user can report content with a reason; duplicate reports by the same user are handled without noise.
- [ ] The admin queue shows open, resolved and dismissed reports, with links to the reported content.
- [ ] An Admin can hide or restore reported content and suspend or reinstate a user.
- [ ] A suspended user can read but every write is rejected with a clear message.
- [ ] Every moderation action records actor, target, action, reason and timestamp.
- [ ] Hidden content disappears from the Board, public routes, counts and the live ticker.
- [ ] Non-admins cannot access the queue or moderation actions.

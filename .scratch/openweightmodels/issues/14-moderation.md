# 14: Report, suspend and remove harmful content

**What to build:** Signed-in users can report a Comparison, Discussion comment or Annotation. Admins get a report queue where they can review, hide or restore content, suspend a user and see an audit trail. Suspended users cannot write, and their existing content follows the chosen moderation policy.

**Blocked by:** 07 — Sign in with email magic links; 10 — Edit and delete your Discussion and Annotations; 11 — Minimal admin for Models and takedowns.

**Status:** done

- [x] A signed-in user can report content with a reason; duplicate reports by the same user are handled without noise.
- [x] The admin queue shows open, resolved and dismissed reports, with links to the reported content.
- [x] An Admin can hide or restore reported content and suspend or reinstate a user.
- [x] A suspended user can read but every write is rejected with a clear message.
- [x] Every moderation action records actor, target, action, reason and timestamp.
- [x] Hidden content disappears from the Board, public routes, counts and the live ticker.
- [x] Non-admins cannot access the queue or moderation actions.

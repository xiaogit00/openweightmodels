# 11: Minimal admin for Models and takedowns

**What to build:** An Admin can enable or disable Models and take a Comparison down without a deploy. Disabling a Model removes it from pickers and blocks new Runs; taking a Comparison down removes it from the Board and public routes while leaving an admin-visible record. Every action is attributable.

**Blocked by:** 07 — Sign in with email magic links; 10 — Edit and delete your Discussion and Annotations.

**Status:** done

- [x] An admin-only surface is reachable only by users with the `admin` role; non-admins get 404/403.
- [x] Enabling or disabling a Model updates pickers immediately and prevents new Runs; existing published Comparisons keep their content.
- [x] An Admin can take a Comparison down and restore it; takedown removes it from the Board, public Comparison routes and the live stream.
- [x] The Admin can see which Comparisons are hidden and why.
- [x] Each action records actor, target, action and timestamp.
- [x] No report queue, user suspension or moderation console is added here; those belong to 14.

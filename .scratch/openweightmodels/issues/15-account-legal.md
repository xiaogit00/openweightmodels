# 15: Account lifecycle and legal surface

**What to build:** The product has the minimum legal and account-lifecycle surface required for public use: Terms and Privacy pages, a data export, account deletion with a defined content policy, and a stated retention policy. Users can understand and exercise control over their data without an admin.

**Blocked by:** 07 — Sign in with email magic links.

**Status:** done

- [x] Terms of Service and Privacy Policy pages are linked from the public shell and describe the actual data collected and processed.
- [x] A signed-in user can export their account data in a machine-readable format.
- [x] A signed-in user can delete their account after an explicit confirmation; the email and session are removed.
- [x] Deletion defines what happens to authored Comparisons, comments and Annotations; the chosen policy is implemented consistently and explained to the user.
- [x] The retention policy for uploaded Base outputs, generated Responses and activity data is documented.
- [x] Deleted-account content does not leave orphaned personal data or broken public pages.
- [x] The legal copy is clearly marked for owner/legal review rather than presented as final without review.

## Comments

Implemented. Policy chosen with the owner: **keep published work under an anonymised attribution** rather than erasing everything, so other people's replies are never destroyed.

- **Deletion** (`packages/core/src/services/account.ts`) runs in one transaction after the member types `DELETE`. It clears email, handle, name, image, avatar and suspension fields, sets `users.deleted_at` (migration `0005_stiff_mandroid.sql`), releases the handle and email, and resets `role` to `user`. Sessions, auth accounts, pending hashed magic-link rows, notifications, reports the member filed, votes cast and votes on their content, and ticker rows naming them are deleted. Unpublished Comparisons (and their Base outputs, generated Responses, Jobs, Annotations and Discussion) are deleted. Published Comparisons stay and render `[deleted]` as their author. Discussion comments become tombstones so replies by other people survive; Annotations follow the existing author-delete rule and lose their highlight and thread; `comment_count` and `annotation_count` are decremented exactly. One summary-less `account.deleted` SSE event per affected Comparison carries the count deltas and ids to retract. Guards: wrong confirmation (`400 confirmation_required`), second deletion (`409 account_deleted`), last remaining Admin (`409 last_admin`).
- **Export** (`GET /api/account/export`) returns `openweightmodels-<handle>-<date>.json` with `formatVersion: 1`, the account's profile, Comparisons (base output and generated Responses), comments, Annotations (own thread messages only), the account's replies in other people's Annotation threads, votes, notifications and reports it filed. Other people's emails and words are excluded by construction.
- **UI**: `/account` shows the identity, a data download and a danger zone with typed confirmation. The account menu links to it.
- **Legal**: `/terms` and `/privacy` are linked from a shared footer in the root layout and from the account page. The copy describes the actual data inventory, processors, retention table, export, deletion and rights. Both pages carry a visible "Draft for owner and legal review" banner and bracketed placeholders. `docs/PRIVACY.md` is the internal retention/deletion reference plus the pre-launch review checklist.
- **Verified**: `pnpm typecheck` passes (core, web, worker, E2E). `pnpm test` passes, including four new `packages/core/test/account.test.ts` cases (published kept, private erased, tombstones with surviving replies and exact counters, sessions/magic links/votes/ticker removed, handles freed, guards, export isolation). `e2e/account.spec.ts` passes: sign in → comment → export download → typed confirmation → signed-out Board → tombstone and removed wording, plus footer links to both legal pages.
- **Remaining for launch**: owner/legal review and the bracketed placeholders; a scheduled pruning job for expired sessions and verification rows (they are inert today and removed with the account).

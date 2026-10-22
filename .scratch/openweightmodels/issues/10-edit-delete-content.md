# 10: Edit and delete your Discussion and Annotations

**What to build:** Content owners can correct or remove their own Discussion comments, Annotations and Annotation thread messages. Deletions follow the tombstone rules, counters stay correct, deleting an Annotation removes its highlight and thread, and nobody sees controls for content they do not own.

**Blocked by:** 07 — Sign in with email magic links.

**Status:** done

- [x] An owner can edit or delete their own Discussion comment through a kebab menu with inline save/cancel and the existing body limit.
- [x] Deleting a comment with replies produces a tombstone; deleting a childless comment removes it and its votes; `comment_count` updates.
- [x] An Annotation owner can change its kind or delete it; the highlight and thread disappear and `annotation_count` updates.
- [x] An Annotation message owner can edit or delete their message; a deleted message is tombstoned.
- [x] Non-owners see no edit/delete controls and receive 403 if they call the API directly.
- [x] Discussion filters, votes and reply attribution remain correct after edits and deletions.
- [x] Deleted content never appears in the public Board ticker or counts.

## Comments

- 2026-10-22 — Implemented. Discussion comments and replies, Annotation thread messages and the Annotation itself gained owner-only kebab menus. Comments and messages edit inline with Save/Cancel; deleting asks for confirmation in the menu and then re-reads the Discussion from the server, so a reply added since the page loaded still produces a tombstone. Annotation owners can retag in four ways or delete the highlight and whole thread. `getAnnotationViews` now returns tombstoned thread messages (`body: ''`, `deletedAt` set) so a deleted message renders as `[deleted]` instead of vanishing. The Discussion counter excludes tombstones, and the Annotation toolbar count falls when an Annotation is deleted. Deleting content removes its ticker rows and emits a summary-less `*.deleted` event, so an open Board lowers the card count and drops the ticker line without a refetch. Covered by `packages/core/test/edit-delete.test.ts` (edit limits, hard delete and votes, tombstone plus reply attribution, counters, ticker retraction, retag, message tombstone, Annotation deletion), `apps/web/test/discussion.test.ts` (client edit/count rules), and `e2e/edit-delete.spec.ts` (inline edit, hard delete, tombstone, live Board count and ticker retraction, retag, thread tombstone, and no controls plus 403 for non-owners).

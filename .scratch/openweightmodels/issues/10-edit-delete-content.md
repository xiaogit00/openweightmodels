# 10: Edit and delete your Discussion and Annotations

**What to build:** Content owners can correct or remove their own Discussion comments, Annotations and Annotation thread messages. Deletions follow the tombstone rules, counters stay correct, deleting an Annotation removes its highlight and thread, and nobody sees controls for content they do not own.

**Blocked by:** 07 — Sign in with email magic links.

**Status:** ready-for-agent

- [ ] An owner can edit or delete their own Discussion comment through a kebab menu with inline save/cancel and the existing body limit.
- [ ] Deleting a comment with replies produces a tombstone; deleting a childless comment removes it and its votes; `comment_count` updates.
- [ ] An Annotation owner can change its kind or delete it; the highlight and thread disappear and `annotation_count` updates.
- [ ] An Annotation message owner can edit or delete their message; a deleted message is tombstoned.
- [ ] Non-owners see no edit/delete controls and receive 403 if they call the API directly.
- [ ] Discussion filters, votes and reply attribution remain correct after edits and deletions.
- [ ] Deleted content never appears in the public Board ticker or counts.

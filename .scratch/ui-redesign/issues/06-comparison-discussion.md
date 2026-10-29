# 06: Redesign the Comparison Discussion

**What to build:** The Discussion section: title/count/filter, composer, signed-out and suspended gating, comments, replies, votes, reporting, editing and deleting. All current behaviour, new visual language.

**Blocked by:** 04.

**Status:** ready-for-agent.

**Design source:** the "Discussion" subsection of "Screen 3 — Comparison" in `design_handoff_redesign/README.md`.

- [ ] Section max-width 800px, padding-top 32px.
- [ ] Title row: H2 "Discussion" at 20px, total count (comments + replies), and a segmented filter **All / <Base model> / each ready Challenger / General** using full model names. The active filter is `aria-pressed`.
- [ ] Composer card: `--color-surface`, 1px `neutral-700`, `--r-lg`, 14px padding; borderless textarea with placeholder "Share what you noticed across the outputs…"; **About** chips (General + each model) with the selected one accent-bordered; outlined **Post** button. Posting prepends the comment and resets the filter to All.
- [ ] **Gating stays:** signed-out visitors see the current "Sign in to join the discussion" prompt with a Sign in link instead of the composer; suspended viewers see the current read-only message; errors and posting states still render.
- [ ] Empty state: "No comments yet. Be the first to share what you noticed." The filtered-empty state keeps its current wording.
- [ ] Comment: 28px avatar; author at 500 / `neutral-100`, time, optional `on <model>` chip; body 14.5px / 1.65; action row with upvote (filled arrow + `accent-300` when voted, +1), Reply, and Report for other people's comments (toggles to "Reported" with a filled flag).
- [ ] **Own comments keep edit and delete**, not just delete: the "…" menu holds Edit and Delete with the current confirmation and inline editor. **Own replies** keep edit and delete.
- [ ] Reply behaviour: pre-fills the composer with `@handle `, sets About to the comment's model and focuses the composer. Replies render indented 16px with a 1px `neutral-700` left rule, 22px avatar, author · time, 14px body, their own upvote, and report for other people's replies.
- [ ] Deleted comments and replies keep their current tombstones so other people's replies survive.
- [ ] Keep `data-comment`, `data-comment-count`, `data-comment` ids, and the labels `Write a comment`, `Edit comment`, `Edit reply`, `Comment actions`, `Reply actions`, `Post`.
- [ ] Both themes; keyboard operations (menus, reply, voting) still work; axe clean.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` pass, including `discussion.test.ts`, `keyboard.spec.ts`, `a11y.spec.ts` and `edit-delete.spec.ts`.

**Key files:** `apps/web/src/components/comparison-view.tsx` (Discussion section), `apps/web/src/lib/discussion.ts`, `report-control.tsx`, `e2e/discussion`-related specs.

**Implementation notes:** Keep optimistic mutations and the current error recovery. The model filter uses only ready Challengers, as today. Do not make replies deeper than one level. The "on <model>" chip is the only place a comment names a model in its header; preserve that.

**Out of scope:** Comment pagination, new reaction types, Discussion on other screens.
